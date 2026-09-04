// Chain reader (spec §1, §5.2). Verify's ONLY structural input is the RCF
// chain — the acceptance contract. It reads the acceptance criteria off the
// chain through the SAME store code build-lite uses (core's walkTree), never
// the source tree, the test suite, or the builder's self-report (§9
// independence guarantee 2). It imports core's READ path only — never
// writer.js / init.js (§7.2 boundary).
//
// 0.7.0 additions (verification-integrity-cluster-spec §5.2, ui-design-gate
// §8.7): the flattened AC read-out is extended with two derived fields —
// `serviceAttestations` (aggregated from every FBS's `dependsOnServices[]`
// whose `acIds` include this AC) and `fbsUiBearing` (true when any of the
// FBSes bound to this AC has `uiBearing: true`). Both derivations live
// HERE, in verify's chain reader, per the tonight's clarification (Track A
// changelog 2026-07-31, Track B §18 N2 fold): core's walker surfaces raw
// document fields only, verify does the AC-level aggregation. Core 0.3.0
// carries a walker-guard test that asserts no such derivation leaks into
// core (`packages/rcf-lite/test/core/store/walker-0-7-0-fields.test.js:580`).
//
// The manifest fields verify's report and verdict pipelines need
// (`uiBaseline`, `browserVerification[]`) are read verbatim off `tree.manifest`
// and surfaced on the read result — verify's downstream code consumes them
// through the chain reader, not by re-opening the manifest.

import { access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { rcfError } from '#core/errors';
import { walkTree } from '#core/store';

/**
 * Resolve a --repo path-or-ref to the project root that holds rcf/manifest.json.
 * v1 treats --repo as a filesystem path (path refs to remote sources are
 * deferred). Walks the given path and its ancestors, like build's finder.
 *
 * @param {string} startPath
 * @returns {Promise<string | null>}
 */
export async function findProjectRoot(startPath) {
  let dir = resolve(startPath);
  // Walk up until we find rcf/manifest.json or hit the filesystem root.
  // Bounded loop guard: dirname stabilises at the root.
  for (let i = 0; i < 64; i += 1) {
    try {
      await access(join(dir, 'rcf', 'manifest.json'));
      return dir;
    } catch {
      // not here — climb
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Aggregate FBS `dependsOnServices[]` into per-AC serviceAttestations. For
 * each AC that an FBS binds (via `fbs.acIds`), every entry in the FBS's
 * `dependsOnServices` whose `acIds` mention the AC produces a
 * `{serviceId, attestationMode}` on that AC's attestation list. An AC bound
 * by several FBSes accumulates every service dependency across all of them,
 * so an `AC-101-2` covered by FBS-011 (`resend` attested `mocked`) and
 * FBS-014 (`stripe` attested `live`) surfaces both attestations on that
 * AC. Order is deterministic: FBSes visited in `fbsItems` order, services
 * in each FBS's declared order.
 *
 * @param {object[]} fbsItems
 * @param {string} acId
 * @returns {Array<{serviceId: string, attestationMode: string}>}
 */
function serviceAttestationsFor(fbsItems, acId) {
  const out = [];
  for (const fbs of fbsItems ?? []) {
    if (!Array.isArray(fbs.acIds) || !fbs.acIds.includes(acId)) continue;
    for (const dep of fbs.dependsOnServices ?? []) {
      if (!dep || typeof dep.id !== 'string' || typeof dep.attestationMode !== 'string') continue;
      const acIds = Array.isArray(dep.acIds) ? dep.acIds : [];
      if (acIds.length === 0 || acIds.includes(acId)) {
        out.push({ serviceId: dep.id, attestationMode: dep.attestationMode });
      }
    }
  }
  return out;
}

/**
 * True when any FBS bound to `acId` has `uiBearing: true`. Verify uses this
 * flag to gate its UI-baseline verdict emission (§8.7) — a UI-bearing AC is
 * exposed to `UI-BASELINE-UNMET` / `BROWSER-VERIFICATION-MISSING`, while a
 * non-UI AC is not.
 *
 * @param {object[]} fbsItems
 * @param {string} acId
 * @returns {boolean}
 */
function fbsUiBearingFor(fbsItems, acId) {
  for (const fbs of fbsItems ?? []) {
    if (!Array.isArray(fbs.acIds) || !fbs.acIds.includes(acId)) continue;
    if (fbs.uiBearing === true) return true;
  }
  return false;
}

/**
 * The FBS ids bound to `acId` (via `fbs.acIds`), preserving `fbsItems`
 * order. Verify uses this to resolve the browserVerification entries for
 * an AC when deciding UI-BASELINE-UNMET vs BROWSER-VERIFICATION-MISSING.
 *
 * @param {object[]} fbsItems
 * @param {string} acId
 * @returns {string[]}
 */
function fbsIdsFor(fbsItems, acId) {
  const out = [];
  for (const fbs of fbsItems ?? []) {
    if (!Array.isArray(fbs.acIds) || !fbs.acIds.includes(acId)) continue;
    if (typeof fbs.fbsId === 'string') out.push(fbs.fbsId);
  }
  return out;
}

/**
 * The bound TCs for `acId`, each carrying its own scope tag (if the TC
 * declares one; unspecified surfaces as `undefined`). 0.8.0 slug-train
 * car 4 (NV-BL-GATE-01: pull rcf-verify profile-vs-AC check into the
 * REVIEW stage). Verify uses this to detect SCOPE-MISMATCH per-AC
 * verdicts: a bound TC whose scope is NARROWER than the AC's scope tag
 * cannot legitimately cover that AC (per NV-BL-ADM-03).
 *
 * @param {object[]} testSuites
 * @param {string} acId
 * @returns {Array<{ tsId: string, tcId: string, scope: string|undefined }>}
 */
function boundTcsFor(testSuites, acId) {
  const out = [];
  for (const ts of testSuites ?? []) {
    for (const tc of ts.testCases ?? []) {
      if (tc?.acId !== acId) continue;
      out.push({ tsId: ts.id, tcId: tc.id, scope: tc.scope });
    }
  }
  return out;
}

/**
 * rcf-eval-node spec 2026-09-04 sections 3 + 5. Aggregate the EVAL
 * binding state for one AC. Reads:
 *   - `evalIds`: every EVAL under the parent US whose acIds[] names
 *     this AC.
 *   - `evalStatus`: `resolving` | `pending` | `superseded` | `absent`.
 *     `resolving` = at least one bound EVAL is not superseded AND has
 *     at least one runRecord[] entry whose verdict is not `pending`.
 *   - `evalRunVerdict`: the freshest runRecord[] verdict on the
 *     resolving EVAL: `pass` | `fail` | `pending` | null.
 *
 * The consumer (verdict derivation) uses these to decide whether
 * EVAL-MISSING or EVAL-BELOW-THRESHOLD applies.
 *
 * @param {object[]} evals - walker's tree.evals[]
 * @param {string} usId
 * @param {string} acId
 * @returns {{ evalIds: string[], evalStatus: 'resolving'|'pending'|'superseded'|'absent', evalRunVerdict: string|null }}
 */
function evalBindingFor(evals, usId, acId) {
  const bound = (evals ?? []).filter(
    (e) => e?.usId === usId && Array.isArray(e?.acIds) && e.acIds.includes(acId),
  );
  const evalIds = bound.map((e) => e.id);
  if (bound.length === 0) {
    return { evalIds: [], evalStatus: 'absent', evalRunVerdict: null };
  }
  // Pick the best status: resolving beats pending beats superseded.
  let bestRank = -1;
  let bestStatus = 'absent';
  let bestRunVerdict = null;
  for (const evalDoc of bound) {
    let status;
    let runVerdict = null;
    if (evalDoc.status === 'superseded') {
      status = 'superseded';
    } else {
      const records = Array.isArray(evalDoc.runRecord) ? evalDoc.runRecord : [];
      if (records.length === 0) {
        status = 'pending';
      } else {
        const sorted = [...records].sort((a, b) => (a?.runAt ?? '').localeCompare(b?.runAt ?? ''));
        const latest = sorted[sorted.length - 1];
        runVerdict = latest?.verdict ?? null;
        status = runVerdict === 'pending' ? 'pending' : 'resolving';
      }
    }
    const rank = status === 'resolving' ? 3 : status === 'pending' ? 2 : 1;
    if (rank > bestRank) {
      bestRank = rank;
      bestStatus = status;
      bestRunVerdict = runVerdict;
    }
  }
  return { evalIds, evalStatus: bestStatus, evalRunVerdict: bestRunVerdict };
}

/**
 * Read the acceptance contract from the chain. Returns the flattened list of
 * acceptance criteria (each mapped back to its user story + requirement — the
 * chain-node addressing the report carries), plus the resolved chainRef and
 * the manifest fields verify's downstream stages consume.
 *
 * @param {object} opts
 * @param {string} opts.repo - path-or-ref to the RCF chain source
 * @param {string} [opts.chainRef] - which PRD/chain; default = the repo's PRD
 * @returns {Promise<{ acs: Array<object>, chainRef: string, projectRoot: string, manifest: object } | import('#core/errors').RcfError>}
 */
export async function readChain({ repo, chainRef } = {}) {
  if (typeof repo !== 'string' || repo.length === 0) {
    return rcfError({ kind: 'usage', message: '--repo (the RCF chain source) is required', field: 'repo' });
  }
  const projectRoot = await findProjectRoot(repo);
  if (!projectRoot) {
    return rcfError({
      kind: 'missingFile',
      message: `no RCF chain found at or above "${repo}" (no rcf/manifest.json). Verify needs an existing RCF chain as its acceptance contract.`,
      filePath: repo,
    });
  }

  const { tree, errors } = await walkTree({ projectRoot });
  if (errors.length > 0) {
    // A chain that does not load is not verifiable — surface the first
    // structural error (errors-as-data; the CLI maps to a chain-load exit).
    return rcfError({
      kind: 'parseFailure',
      message: `RCF chain failed to load: ${errors[0].message}`,
      filePath: errors[0].filePath,
      documentId: errors[0].documentId,
    });
  }

  const resolvedRef = chainRef ?? tree.prd?.prdId ?? 'PRD-UNKNOWN';
  const fbsItems = tree.fbsItems ?? [];
  const testSuites = tree.testSuites ?? [];
  const evals = tree.evals ?? [];
  const acs = [];
  for (const us of tree.userStories ?? []) {
    for (const ac of us.acceptanceCriteria ?? []) {
      acs.push({
        acId: ac.id,
        usId: us.usId,
        reqId: us.reqId ?? null,
        title: us.title ?? null,
        description: ac.description ?? '',
        given: ac.given ?? '',
        when: ac.when ?? '',
        then: ac.then ?? '',
        testable: ac.testable !== false,
        // rcf-eval-node spec section 2: `determinism` classification on
        // each AC (schema-optional; absence resolves to 'deterministic').
        // Consumed by the eval-coverage derivation below.
        determinism: ac.determinism ?? 'deterministic',
        // rcf-eval-node spec sections 5.1 / 5.2: per-AC EVAL binding
        // aggregate. `evalStatus` is 'resolving' | 'pending' |
        // 'superseded' | 'absent'; `evalRunVerdict` is the most recent
        // runRecord verdict on the resolving EVAL, or null.
        ...evalBindingFor(evals, us.usId, ac.id),
        // 0.7.0 derived fields — verify does the aggregation here per Track A
        // changelog 2026-07-31 and Track B §18 N2 fold; core does not.
        serviceAttestations: serviceAttestationsFor(fbsItems, ac.id),
        fbsUiBearing: fbsUiBearingFor(fbsItems, ac.id),
        fbsIds: fbsIdsFor(fbsItems, ac.id),
        // 0.8.0 slug-train car 4 (NV-BL-GATE-01, NV-BL-ADM-03): scope
        // tags read straight off rcf-schemas 0.4.3's AC/TC subschemas;
        // the verdict layer runs the scope check per-AC in REVIEW,
        // matching what NV-BL-GATE-01 pulls in from the finalise-time
        // profile check.
        scope: ac.scope,
        boundTcs: boundTcsFor(testSuites, ac.id),
      });
    }
  }

  // Manifest carries the ruled UI baseline and the browser-verification
  // record ledger; verify's report + verdict layers read them from here so
  // downstream never re-opens the manifest. Missing manifest is not a
  // failure at this layer (the walker would have surfaced a load error) —
  // an older chain simply has no 0.7.0 fields, and `manifest` is `{}`.
  const manifest = tree.manifest ?? {};

  return { acs, chainRef: resolvedRef, projectRoot, manifest };
}
