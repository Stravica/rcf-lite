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

import { rcfError } from '@stravica-ai/rcf-lite-core/errors';

import { classifyFidelity } from './fidelity.js';
import { scanArtefactForFindings } from './validate.js';
import { composeIntakeRecord } from './manifest-writer.js';

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
 * @returns {Promise<{ record: object } | import('@stravica-ai/rcf-lite-core/errors').RcfError>}
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
  const inputFindings = Array.isArray(input?.validationFindings) ? input.validationFindings : [];
  const inputResponses = new Map();
  for (const f of inputFindings) {
    if (typeof f?.detail === 'string' && typeof f?.operatorResponse === 'string') {
      inputResponses.set(f.detail, f.operatorResponse);
    }
    if (f?.kind === 'otherDeclared') allFindings.push(f);
  }

  const isoNow = now.toISOString();
  const findingsWithTimestamps = allFindings.map((f) => {
    const entry = { kind: f.kind, detail: f.detail, raisedAt: isoNow };
    if (f.kindDescription) entry.kindDescription = f.kindDescription;
    const response = inputResponses.get(f.detail) ?? input?.operatorResponse;
    if (typeof response === 'string' && response.length > 0) {
      entry.operatorResponse = response;
      entry.resolvedAt = isoNow;
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
