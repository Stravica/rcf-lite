// Intake orchestrator (spec §6.4 phases 1-3 combined).
//
// Reads the supplied artefacts, runs the fidelity classifier, applies
// the validation scans, folds in any operator-supplied non-interactive
// input file, and composes an intakeClassification record ready for the
// manifest writer. Never talks to a subagent in v1 (the intake-worker
// dispatch in spec §6.6 is out of scope for this build ship — the
// deterministic scans plus operator-declared "otherDeclared" findings
// via --input cover phase 2 without the reader dispatch).

import { readFile, stat } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';
import { createHash } from 'node:crypto';

import { rcfError } from '#core/errors';

import { classifyFidelity } from './fidelity.js';
import { scanArtefactForFindings } from './validate.js';
import { composeIntakeRecord } from './manifest-writer.js';

/**
 * Run the mechanical intake scans over newly minted brief statements
 * against every pre-existing brief statement. The scans operate on
 * the raw text of the statements; a finding is attributed to the
 * ids of every statement whose text the scan matched (an
 * `impliedButNotStated` cue in one new statement with the matching
 * negated-login phrase elsewhere attributes to both). On a frozen
 * tree the caller passes every pre-existing statement as `existing`;
 * the comparison set is `existing` by definition.
 *
 * Each returned finding carries:
 *   { kind, detail, scanName, ids: number[] }
 * where `kind` is one of the three mechanical kinds from
 * `scanArtefactForFindings`, `ids` lists the involved statement ids
 * from `newStatements` first and then `existing` (duplicates
 * removed), and `scanName` is `kind` for the DEFINE PR 1 wiring.
 *
 * @param {Array<{ id: number, text?: string }>} newStatements
 * @param {Array<{ id: number, text?: string }>} existing
 * @returns {Array<{ kind: string, detail: string, scanName: string, ids: number[] }>}
 */
export function runIntakeScansOnDelta(newStatements, existing) {
  const safeNew = Array.isArray(newStatements) ? newStatements : [];
  const safeExisting = Array.isArray(existing) ? existing : [];
  if (safeNew.length === 0) return [];

  const combined = [...safeNew, ...safeExisting];
  const combinedText = combined.map((s) => (typeof s?.text === 'string' ? s.text : '')).join('\n');
  const rawFindings = scanArtefactForFindings(combinedText);
  if (rawFindings.length === 0) return [];

  // A finding only counts when at least one of the newStatements
  // participates. We attribute by re-running the scan over the
  // `newStatements` alone (if that yields the same kind of finding,
  // the new side is sufficient) OR by running the scan over any
  // (new, existing) pair that contains at least one new statement:
  // the second case detects a contradiction between a new and an
  // existing statement.
  /** @type {Array<{ kind: string, detail: string, scanName: string, ids: number[] }>} */
  const out = [];
  const seen = new Set();
  for (const f of rawFindings) {
    const key = `${f.kind}::${f.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const ids = attributeFinding(f, safeNew, safeExisting);
    if (ids.length === 0) continue;
    out.push({ kind: f.kind, detail: f.detail, scanName: f.kind, ids });
  }
  return out;
}

/**
 * @param {{ kind: string, detail: string }} finding
 * @param {Array<{ id: number, text?: string }>} newStatements
 * @param {Array<{ id: number, text?: string }>} existing
 * @returns {number[]}
 */
function attributeFinding(finding, newStatements, existing) {
  /** @type {number[]} */
  const ids = [];
  for (const s of newStatements) {
    if (statementParticipates(finding, s, [...newStatements, ...existing])) {
      ids.push(Number(s.id));
    }
  }
  if (ids.length === 0) return ids;
  // Also attribute an existing statement that participates on the other side.
  for (const s of existing) {
    if (statementParticipates(finding, s, [...newStatements, ...existing])) {
      if (!ids.includes(Number(s.id))) ids.push(Number(s.id));
    }
  }
  return ids;
}

/**
 * Decide whether `statement.text` contributes to `finding`. The scan
 * is pattern-based and finds the same finding kind on the text in
 * isolation if the statement itself carries the full pattern; for
 * cross-statement findings (a contradiction between two statements)
 * the statement contributes when it carries at least one half of the
 * pattern and the other half appears somewhere in the combined set.
 *
 * @param {{ kind: string, detail: string }} finding
 * @param {{ id: number, text?: string }} statement
 * @param {Array<{ id: number, text?: string }>} combined
 */
function statementParticipates(finding, statement, combined) {
  const text = typeof statement?.text === 'string' ? statement.text : '';
  if (!text) return false;
  const soloFindings = scanArtefactForFindings(text).map((f) => f.kind);
  if (soloFindings.includes(finding.kind)) return true;
  // Cross-statement: pair this statement's text with every other
  // combined text and see whether the pair raises the same finding.
  for (const other of combined) {
    if (other === statement) continue;
    const otherText = typeof other?.text === 'string' ? other.text : '';
    if (!otherText) continue;
    const pairFindings = scanArtefactForFindings(`${text}\n${otherText}`).map((f) => f.kind);
    if (pairFindings.includes(finding.kind) && !soloFindings.includes(finding.kind)) {
      return true;
    }
  }
  return false;
}

/**
 * @typedef {'napkin'|'productBrief'|'prd'|'tad'|'other'} ArtefactKind
 */

const KIND_MAP = new Map([
  ['napkin', 'napkin'],
  ['productbrief', 'productBrief'],
  ['prd', 'prd'],
  ['prdplustad', 'prd'],
  ['tad', 'tad'],
  ['other', 'other'],
]);

/**
 * Read + classify + validate every artefact and compose a full
 * intakeClassification record. Returns an RcfError on IO failure.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {string[]} args.artefactPaths
 * @param {string|null} [args.kindHint]
 * @param {object|null} [args.input]           optional non-interactive input file
 * @param {Date} [args.now]
 * @returns {Promise<{ record: object } | import('#core/errors').RcfError>}
 */
export async function runIntakePhases({ projectRoot, artefactPaths, kindHint = null, input = null, now = new Date() }) {
  const artefactMeta = [];
  const allFindings = [];
  let text = '';
  const paths = [...new Set(artefactPaths)];
  for (const raw of paths) {
    const abs = isAbsolute(raw) ? raw : join(projectRoot, raw);
    let body = '';
    let hash = null;
    let wordCount = 0;
    try {
      body = await readFile(abs, 'utf8');
      const info = await stat(abs);
      void info;
      hash = `sha256:${createHash('sha256').update(body).digest('hex')}`;
      wordCount = body.trim().length === 0 ? 0 : body.trim().split(/\s+/).length;
    } catch (err) {
      return rcfError({
        kind: 'usage',
        message: `intake: cannot read artefact ${raw}: ${err.message}`,
        filePath: raw,
      });
    }
    text += `\n${body}`;
    const kind = resolveKind({ path: raw, kindHint });
    artefactMeta.push({
      path: raw,
      kind,
      wordCount,
      hash,
      operatorSourced: true,
    });
    for (const f of scanArtefactForFindings(body)) allFindings.push(f);
  }

  const { fidelity, signals } = classifyFidelity(text, { kindHint });

  // Fold non-interactive input: extra findings, operator responses,
  // and elicitationScope hints all land here.
  //
  // 0.28.2 (issue #229): findings are material-scoped, not
  // artefact-scoped. Two artefacts that both trip the same branch
  // ("web UI but no sign-in surface named") emit the same finding
  // twice with byte-identical detail text, and downstream that
  // inflated `findings=2` on a record with one finding. Dedupe by
  // `${kind}::${detail}` (first-wins) before timestamping so the
  // material carries one finding, not N.
  //
  // Same commit fixes the second half of #229: operator-supplied
  // `validationFindings` on --input were dropped unless the kind was
  // `otherDeclared`. Fold every input finding into the same map so
  // an operator-authored `impliedButNotStated`, `contradiction` or
  // `missingLoadBearingConstraint` survives the round-trip and
  // coalesces with a scanned duplicate (the operator's response is
  // preserved when it does).
  const inputFindings = Array.isArray(input?.validationFindings) ? input.validationFindings : [];

  /** @type {Map<string, object>} */
  const foldedFindings = new Map();
  const foldKey = (f) => `${String(f.kind ?? '')}::${String(f.detail ?? '')}`;
  for (const f of allFindings) {
    const k = foldKey(f);
    if (!foldedFindings.has(k)) foldedFindings.set(k, f);
  }
  for (const f of inputFindings) {
    if (typeof f?.kind !== 'string' || typeof f?.detail !== 'string') continue;
    const k = foldKey(f);
    if (!foldedFindings.has(k)) foldedFindings.set(k, f);
  }

  // 0.28.2 (Codex review follow-up on #229): the response lookup is
  // keyed by (kind, detail) too, so resolving one finding never
  // silently marks a different-kind finding with the same detail as
  // resolved. Previously the lookup was `detail` only and an
  // answered `impliedButNotStated` leaked its response onto an
  // unanswered `contradiction` with the same detail string.
  const inputResponses = new Map();
  for (const f of inputFindings) {
    if (typeof f?.kind === 'string'
      && typeof f?.detail === 'string'
      && typeof f?.operatorResponse === 'string') {
      inputResponses.set(foldKey(f), f.operatorResponse);
    }
  }

  const isoNow = now.toISOString();
  const findingsWithTimestamps = Array.from(foldedFindings.values()).map((f) => {
    const entry = { kind: f.kind, detail: f.detail, raisedAt: f.raisedAt ?? isoNow };
    if (f.kindDescription) entry.kindDescription = f.kindDescription;
    const response = f.operatorResponse ?? inputResponses.get(foldKey(f)) ?? input?.operatorResponse;
    if (typeof response === 'string' && response.length > 0) {
      entry.operatorResponse = response;
      entry.resolvedAt = f.resolvedAt ?? isoNow;
    }
    return entry;
  });

  const elicitationScope = input?.elicitationScope ?? {
    prdDrafted: fidelity === 'prd' || fidelity === 'prdPlusTad' ? 'supplied' : 'drafted',
    reqDraftedFromArtefact: [],
    reqRequiringElicitation: [],
    acsFromArtefact: 0,
    acsFromElicitation: 'all',
  };

  const record = composeIntakeRecord({
    manifest: null,
    fidelity: input?.fidelity ?? fidelity,
    artefacts: artefactMeta,
    validationFindings: findingsWithTimestamps,
    elicitationScope,
    now,
  });

  void signals; // exposed on classifier return for future observability

  return { record };
}

function resolveKind({ path, kindHint }) {
  const hint = KIND_MAP.get(String(kindHint ?? '').toLowerCase());
  if (hint) return hint;
  const base = basename(path).toLowerCase();
  if (base.includes('napkin')) return 'napkin';
  if (base.includes('prd') && base.includes('tad')) return 'prd';
  if (base.includes('prd')) return 'prd';
  if (base.includes('tad')) return 'tad';
  if (base.includes('brief')) return 'productBrief';
  return 'other';
}
