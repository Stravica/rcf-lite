// `rcf define validate` finding set (0.30.0 PR 8; REQ-178 / TAC-4126).
//
// Four new findings over the walker's schema and broken-reference pass:
//
//   - interface kind outside INTERFACE_KINDS (spec section 4 validate
//     row; AC-17802-1).
//   - bracketed AC class prefix outside the five known classes (spec
//     section 4 validate row; AC-17802-2). An AC description with NO
//     leading bracketed prefix is NOT a finding (decision 10, kept).
//   - tacIds naming a non-TAC (spec section 4 validate row).
//   - ownerRef or deliveredBy that does not resolve on the walker tree
//     (spec section 4 validate row).
//
// These four are pure over the walker tree model: no filesystem I/O; the caller
// (src/cli/validate.js) merges the returned entries into the `errors`
// array it already exits on (exit 3), so --json and the text report
// render these exactly as a schema or broken-reference error does.
// FBS-235 adds the verification rule and its worklist (end of this
// file): the rule reads the base commit's stories through git (one
// cat-file batch, read only); the worklist is pure over the tree.
//
// Shape of each finding (matches rcfError shape consumed by
// formatErrors): { kind: 'defineValidate', rule, documentId, filePath,
// field, message }. `rule` fixes the class so a caller can match on
// one of five constants rather than a message substring.
//
// Decision 10 is binding: a validate finding for a missing class
// marker would fail the dogfood tree and every legacy tree's CI; D4
// reports absence as the floor already.

import { INTERFACE_KINDS, resolveOwnerRefField } from '../query/gates.js';
import { scopingSpec } from '../query/coverage.js';
import { readObjects } from '../audit/separation.js';

/** @typedef {{ kind: 'defineValidate', rule: string, documentId: string|null, filePath: string|null, field: string|null, message: string }} DefineValidateFinding */

const INTERFACE_KINDS_SET = new Set(INTERFACE_KINDS);
/** Known AC-class prefix set (same source of truth as src/query/gates.js). */
const KNOWN_AC_CLASSES = new Set(['happy', 'edge', 'failure', 'must-not', 'non-functional']);
/** Leading bracketed prefix on an AC description. */
const BRACKET_PREFIX_RE = /^\[([^\]]+)\]/;

/**
 * Collect PR 8 define-validate findings from a walker tree model.
 *
 * @param {object} tree - walker tree.
 * @returns {DefineValidateFinding[]}
 */
export function collectDefineValidateFindings(tree) {
  /** @type {DefineValidateFinding[]} */
  const findings = [];
  const tacIds = new Set();
  for (const tac of tree.tacs ?? []) {
    if (tac && typeof tac.tacId === 'string') tacIds.add(tac.tacId);
  }
  const allIds = tree.byId instanceof Map ? new Set(tree.byId.keys()) : new Set();

  // 1. Interface kinds outside the vocabulary.
  for (const tac of tree.tacs ?? []) {
    const interfaces = Array.isArray(tac.interfaces) ? tac.interfaces : [];
    for (const iface of interfaces) {
      const kind = iface?.kind;
      if (typeof kind === 'string' && INTERFACE_KINDS_SET.has(kind)) continue;
      // Only emit a finding when `kind` is a string (walker schema
      // already covers absent / non-string with its own error).
      if (typeof kind !== 'string') continue;
      findings.push({
        kind: 'defineValidate',
        rule: 'defineValidate:interfaceKind',
        documentId: tac.tacId ?? null,
        filePath: null,
        field: `interfaces[${iface?.name ?? '?'}].kind`,
        message: `define validate: interface kind ${JSON.stringify(kind)} on ${tac.tacId}:${iface?.name ?? '(unnamed)'} is outside the closed vocabulary ${JSON.stringify([...INTERFACE_KINDS])}`,
      });
    }
  }

  // 2. AC class prefix outside the known classes. Absence is NOT a
  // finding (decision 10). Iterate every US's inline AC array.
  for (const us of tree.userStories ?? []) {
    const acs = Array.isArray(us.acceptanceCriteria) ? us.acceptanceCriteria : [];
    for (const ac of acs) {
      const desc = typeof ac?.description === 'string' ? ac.description : '';
      const m = desc.match(BRACKET_PREFIX_RE);
      if (!m) continue;
      const prefix = m[1].trim();
      if (KNOWN_AC_CLASSES.has(prefix)) continue;
      findings.push({
        kind: 'defineValidate',
        rule: 'defineValidate:acClassPrefix',
        documentId: ac?.id ?? us?.usId ?? null,
        filePath: null,
        field: 'description',
        message: `define validate: AC ${ac?.id ?? '(unknown id)'} on ${us?.usId ?? '(unknown story)'} starts with bracketed prefix [${prefix}] which is not one of {happy, edge, failure, must-not, non-functional}`,
      });
    }
  }

  // 3. tacIds on a US naming a non-TAC.
  for (const us of tree.userStories ?? []) {
    const ids = Array.isArray(us.tacIds) ? us.tacIds : [];
    for (const id of ids) {
      if (typeof id !== 'string') continue;
      if (tacIds.has(id)) continue;
      findings.push({
        kind: 'defineValidate',
        rule: 'defineValidate:tacIdsResolves',
        documentId: us.usId ?? null,
        filePath: null,
        field: 'tacIds',
        message: `define validate: US ${us.usId ?? '(unknown)'} tacIds entry ${JSON.stringify(id)} does not resolve to any TAC on the tree`,
      });
    }
  }

  // 4a. ownerRef on an AC that does not resolve under R11 grammar on
  //     the named TAC or ADR (spec section 17, 2026-10-03). The
  //     `resolveOwnerRefField` helper accepts `interfaces[<name>]`,
  //     `responsibilities[<n>]`, `dependencies[<name>]`,
  //     `alternativesConsidered[<n>]` and bare schema fields
  //     (`purpose`, `internalStructure`, `decision`, etc.). Dotted
  //     forms are refused: the finding message names the field so
  //     the author can rewrite to bracket grammar.
  const tacByIdLocal = new Map();
  for (const tac of tree.tacs ?? []) {
    if (tac?.tacId) tacByIdLocal.set(tac.tacId, tac);
  }
  const adrByIdLocal = new Map();
  for (const adr of tree.adrs ?? []) {
    if (adr?.adrId) adrByIdLocal.set(adr.adrId, adr);
  }
  for (const us of tree.userStories ?? []) {
    const acs = Array.isArray(us.acceptanceCriteria) ? us.acceptanceCriteria : [];
    for (const ac of acs) {
      const ref = ac?.ownerRef;
      if (!ref || typeof ref !== 'object') continue;
      const tacId = typeof ref.tacId === 'string' ? ref.tacId : null;
      const adrId = typeof ref.adrId === 'string' ? ref.adrId : null;
      const field = typeof ref.field === 'string' ? ref.field : null;
      if ((!tacId && !adrId) || !field) continue;
      let owner = null;
      let ownerLabel = null;
      if (tacId) {
        owner = tacByIdLocal.get(tacId) ?? null;
        ownerLabel = tacId;
        if (!owner) {
          findings.push({
            kind: 'defineValidate',
            rule: 'defineValidate:ownerRefResolves',
            documentId: ac?.id ?? us?.usId ?? null,
            filePath: null,
            field: 'ownerRef',
            message: `define validate: AC ${ac?.id ?? '(unknown)'} ownerRef names TAC ${JSON.stringify(tacId)} which is not on the tree`,
          });
          continue;
        }
      } else if (adrId) {
        owner = adrByIdLocal.get(adrId) ?? null;
        ownerLabel = adrId;
        if (!owner) {
          findings.push({
            kind: 'defineValidate',
            rule: 'defineValidate:ownerRefResolves',
            documentId: ac?.id ?? us?.usId ?? null,
            filePath: null,
            field: 'ownerRef',
            message: `define validate: AC ${ac?.id ?? '(unknown)'} ownerRef names ADR ${JSON.stringify(adrId)} which is not on the tree`,
          });
          continue;
        }
      }
      if (!resolveOwnerRefField(owner, field)) {
        findings.push({
          kind: 'defineValidate',
          rule: 'defineValidate:ownerRefResolves',
          documentId: ac?.id ?? us?.usId ?? null,
          filePath: null,
          field: 'ownerRef',
          message: `define validate: AC ${ac?.id ?? '(unknown)'} ownerRef.field ${JSON.stringify(field)} does not resolve on ${ownerLabel} under R11 grammar (bracket forms: interfaces[<name>], responsibilities[<n>], dependencies[<name>], alternativesConsidered[<n>]; or a bare schema field name)`,
        });
      }
    }
  }

  // 4b. deliveredBy on a REQ. Two forms are accepted by the schema:
  //     (i) a legacy string that must resolve to any id in the tree
  //     (back-compat for pre-DEFINE REQs; the walker's own schema
  //     check has long since been dropped so no production REQ should
  //     carry a bare string, but this path remains defensive);
  //     (ii) the object form `{ tacId | adrId, field }` which R11
  //     resolves under the same grammar as `ownerRef`. The object
  //     form was silently skipped before PR 9 (review 2026-10-03).
  for (const req of tree.requirements ?? []) {
    const d = req?.deliveredBy;
    if (typeof d === 'string' && d.length > 0) {
      if (!allIds.has(d)) {
        findings.push({
          kind: 'defineValidate',
          rule: 'defineValidate:deliveredByResolves',
          documentId: req.reqId ?? null,
          filePath: null,
          field: 'deliveredBy',
          message: `define validate: REQ ${req.reqId ?? '(unknown)'} deliveredBy ${JSON.stringify(d)} does not resolve to any document on the tree`,
        });
      }
      continue;
    }
    if (!d || typeof d !== 'object') continue;
    const tacId = typeof d.tacId === 'string' ? d.tacId : null;
    const adrId = typeof d.adrId === 'string' ? d.adrId : null;
    const field = typeof d.field === 'string' ? d.field : null;
    if (!tacId && !adrId) continue;
    let owner = null;
    let ownerLabel = null;
    if (tacId) {
      owner = tacByIdLocal.get(tacId) ?? null;
      ownerLabel = tacId;
      if (!owner) {
        findings.push({
          kind: 'defineValidate',
          rule: 'defineValidate:deliveredByResolves',
          documentId: req.reqId ?? null,
          filePath: null,
          field: 'deliveredBy',
          message: `define validate: REQ ${req.reqId ?? '(unknown)'} deliveredBy names TAC ${JSON.stringify(tacId)} which is not on the tree`,
        });
        continue;
      }
    } else if (adrId) {
      owner = adrByIdLocal.get(adrId) ?? null;
      ownerLabel = adrId;
      if (!owner) {
        findings.push({
          kind: 'defineValidate',
          rule: 'defineValidate:deliveredByResolves',
          documentId: req.reqId ?? null,
          filePath: null,
          field: 'deliveredBy',
          message: `define validate: REQ ${req.reqId ?? '(unknown)'} deliveredBy names ADR ${JSON.stringify(adrId)} which is not on the tree`,
        });
        continue;
      }
    }
    // `field` is schema-optional on deliveredBy; a REQ whose
    // deliveredBy carries only a tacId/adrId with no field names the
    // whole owner and resolves by presence of the owner alone.
    if (!field) continue;
    if (!resolveOwnerRefField(owner, field)) {
      findings.push({
        kind: 'defineValidate',
        rule: 'defineValidate:deliveredByResolves',
        documentId: req.reqId ?? null,
        filePath: null,
        field: 'deliveredBy',
        message: `define validate: REQ ${req.reqId ?? '(unknown)'} deliveredBy.field ${JSON.stringify(field)} does not resolve on ${ownerLabel} under R11 grammar (bracket forms: interfaces[<name>], responsibilities[<n>], dependencies[<name>], alternativesConsidered[<n>]; or a bare schema field name)`,
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// FBS-235 (US-19801, US-19802; ADR-4155, TAC-4152): the verification rule
// and its worklist.
//
// A live criterion (one with no supersededBy) that is new since the base
// (its id absent from every story at the base) or amended since it (its
// description, given, when or then differs from the same id at the base)
// and carries no verification field is an error (exit 3). The base is
// --base <ref>, else the merge-base of HEAD with origin/main; with neither
// the rule is report-only and validate prints one warn line. The base
// stories are read through git in one `git cat-file --batch` (the
// plumbing form of `git show <base>:<path>` for every story file at the
// base), from the project root, so the chain may sit below the repository
// root. Retired criteria are never required to carry the flag and never
// appear in the worklist. The worklist (`--report verification`) reads the
// walker tree only and never writes or suggests a flag.

export const VERIFICATION_FLAGS = '(external | testOnly)';
export const VERIFICATION_NO_BASE_WARNING = '[warn] verification: no base ref; new and amended criteria not checked';

const isLive = (ac) => typeof ac?.supersededBy !== 'string';
const hasFlag = (ac) => typeof ac?.verification === 'string';
const compareAcIds = (a, b) => a.localeCompare(b, 'en', { numeric: true });

/**
 * Resolve the verification base: --base <ref> when given, else the
 * merge-base of HEAD with origin/main.
 *
 * @param {{ base?: string, git: (args: string[], input?: string|null) => Promise<{ code: number|null, stdout: string, raw: Buffer }> }} opts
 *   `git` runs in the project root (runGit from src/audit/separation.js).
 * @returns {Promise<{ sha: string } | { sha: null } | { badRef: string }>}
 *   `sha: null` when no base is resolvable without --base (report-only);
 *   `badRef` when --base names a ref that does not resolve (exit 2).
 */
export async function resolveVerificationBase({ base, git }) {
  if (typeof base === 'string') {
    const [obj] = await readObjects(git, [`${base}^{commit}`]);
    return obj.missing ? { badRef: base } : { sha: obj.sha };
  }
  const [main, head] = await readObjects(git, ['origin/main^{commit}', 'HEAD^{commit}']);
  if (main.missing || head.missing) return { sha: null };
  const mb = await git(['merge-base', main.sha, head.sha]);
  const sha = mb.code === 0 ? mb.stdout.trim() : '';
  return /^[0-9a-f]{40,64}$/.test(sha) ? { sha } : { sha: null };
}

/**
 * Every criterion of every story file under rcf/user-stories/ at the
 * base commit, by id: { description, given, when, then }. A story file
 * at the base that does not parse contributes no criterion.
 *
 * @param {(args: string[], input?: string|null) => Promise<{ code: number|null, stdout: string, raw: Buffer }>} git
 * @param {string} sha - the base commit
 * @returns {Promise<Map<string, object>>}
 */
export async function readBaseCriteria(git, sha) {
  const ls = await git(['ls-tree', '-r', '-z', '--full-name', '--name-only', sha, '--', 'rcf/user-stories/']);
  const paths = ls.code === 0 ? ls.stdout.split('\0').filter((p) => p.endsWith('.json')) : [];
  const byId = new Map();
  for (const obj of await readObjects(git, paths.map((p) => `${sha}:${p}`))) {
    if (obj.missing || obj.type !== 'blob') continue;
    let story;
    try {
      story = JSON.parse(obj.text);
    } catch {
      continue;
    }
    for (const ac of Array.isArray(story?.acceptanceCriteria) ? story.acceptanceCriteria : []) {
      if (typeof ac?.id === 'string') byId.set(ac.id, ac);
    }
  }
  return byId;
}

/** The criterion text fields an amendment is judged on (ADR-4155). */
const AMENDING_FIELDS = ['description', 'given', 'when', 'then'];

/**
 * True when the criterion's description, given, when or then differs
 * from the same criterion at the base. testable, ownerRef, verification
 * and the supersession fields never make a criterion amended.
 *
 * @param {object} ac - the criterion at the head
 * @param {object} was - the same id at the base
 */
export function isAmended(ac, was) {
  return AMENDING_FIELDS.some((f) => JSON.stringify(ac?.[f]) !== JSON.stringify(was?.[f]));
}

/**
 * The verification rule's findings: one per live criterion that is new or
 * amended since the base and carries no verification flag. Each renders
 * through formatErrors as "[error] verification <AC id> is new|amended
 * since <base7> and carries no verification flag (external | testOnly)".
 *
 * @param {object} tree - walker tree
 * @param {{ sha: string, criteria: Map<string, object> }} base
 * @returns {Array<{ kind: 'verification', rule: string, documentId: null, filePath: null, field: string, message: string }>}
 */
export function collectVerificationFindings(tree, base) {
  const base7 = base.sha.slice(0, 7);
  const findings = [];
  const acs = (tree.userStories ?? []).flatMap((us) => (Array.isArray(us.acceptanceCriteria) ? us.acceptanceCriteria : []));
  for (const ac of [...acs].sort((a, b) => compareAcIds(String(a?.id), String(b?.id)))) {
    if (typeof ac?.id !== 'string' || !isLive(ac) || hasFlag(ac)) continue;
    const was = base.criteria.get(ac.id);
    const change = was === undefined ? 'new' : isAmended(ac, was) ? 'amended' : null;
    if (!change) continue;
    findings.push({
      kind: 'verification',
      rule: `verification:${change}`,
      // The criterion id leads the message, so the line reads
      // "[error] verification <AC id> ..." (formatError prints the
      // documentId with a colon when one is set).
      documentId: null,
      filePath: null,
      field: 'verification',
      message: `${ac.id} is ${change} since ${base7} and carries no verification flag ${VERIFICATION_FLAGS}`,
    });
  }
  return findings;
}

/**
 * The flag sweep's worklist: every live criterion with no verification
 * field, in id order, with its story, the spec scoping it (the one the
 * coverage end state reads, or null) and its description; and the count
 * of live criteria. Pure over the walker tree: it never writes and never
 * assigns or suggests a flag.
 *
 * @param {object} tree - walker tree
 * @returns {{ unflagged: Array<{ acId: string, usId: string, fbsId: string|null, description: string }>, live: number }}
 */
export function verificationWorklist(tree) {
  const unflagged = [];
  let live = 0;
  for (const us of tree.userStories ?? []) {
    for (const ac of Array.isArray(us.acceptanceCriteria) ? us.acceptanceCriteria : []) {
      if (typeof ac?.id !== 'string' || !isLive(ac)) continue;
      live += 1;
      if (hasFlag(ac)) continue;
      unflagged.push({
        acId: ac.id,
        usId: us.usId,
        fbsId: scopingSpec(tree, ac.id)?.fbsId ?? null,
        description: typeof ac.description === 'string' ? ac.description : '',
      });
    }
  }
  unflagged.sort((a, b) => compareAcIds(a.acId, b.acId));
  return { unflagged, live };
}
