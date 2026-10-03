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
// Pure over the walker tree model: no filesystem I/O; the caller
// (src/cli/validate.js) merges the returned entries into the `errors`
// array it already exits on (exit 3), so --json and the text report
// render these exactly as a schema or broken-reference error does.
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
