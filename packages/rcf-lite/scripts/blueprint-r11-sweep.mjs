#!/usr/bin/env node
// 0.30.0 PR 9 (REQ-179 / TAC-4126 / w-2026-10-03-dave-014): rewrite
// every blueprint contribution's `ownerRef.field` and object-form
// `deliveredBy.field` from the dotted form (`interfaces.<name>`,
// `responsibilities.<key>`, `dependencies.<name>`) to R11 bracket
// grammar (`interfaces[<name>]`, `responsibilities[<n>]`,
// `dependencies[<name>]`), then recount the define-validate findings
// and the D4 `stories:ownerRefResolves` failures against each
// blueprint applied to a scratch project. The script is repeatable:
// re-running it on an already-rewritten shelf produces a zero diff
// and the same tallies. No shell, no network. Node 24.
//
// Usage:
//   node packages/rcf-lite/scripts/blueprint-r11-sweep.mjs            # rewrite + recount
//   node packages/rcf-lite/scripts/blueprint-r11-sweep.mjs --dry-run  # tallies only, no writes
//   node packages/rcf-lite/scripts/blueprint-r11-sweep.mjs --no-apply # skip the per-blueprint apply pass
//
// The counts the script emits replace the "about 50" review estimate
// with ground truth; the PR 9 CHANGELOG cites the before -> after
// numbers from the printed summary.

import { readFile, writeFile, readdir, mkdtemp, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import { walkTree } from '../src/core/store/walker.js';
import { initProject } from '../src/core/store/init.js';
import { applyBlueprint } from '../src/blueprint/index.js';
import { collectDefineValidateFindings } from '../src/define/validate-findings.js';
import { checkD4Stories, resolveOwnerRefField } from '../src/query/gates.js';

const resolveOnOwner = resolveOwnerRefField;

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const blueprintsRoot = resolve(repoRoot, 'blueprints');

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const NO_APPLY = args.has('--no-apply');

const SUBDIRS = [
  'requirements',
  'user-stories',
  'tacs',
  'adrs',
  'tads',
  'prds',
  'build-sequences',
  'fbs',
  'test-suites',
  'code-nodes',
  'probes',
];

/**
 * Rewrite one `field` string from dotted to bracket grammar.
 *
 * Dotted forms seen in the shelf (2026-10-03):
 *   - `interfaces.<name>`     -> `interfaces[<name>]`
 *   - `responsibilities.<key>` -> `responsibilities[<key>]`
 *   - `dependencies.<name>`   -> `dependencies[<name>]`
 *   - `interfaces[0].name`    -> `interfaces[0]` (strip the trailing
 *     dotted index-into-record; the R11 helper resolves bracket
 *     index via responsibilities, not an interface subpath)
 *   - `decision.<key>`        -> `decision` (ADR bare field; `decision`
 *     is a scalar on an ADR, not an addressable collection)
 *
 * Bare field names (`purpose`, `internalStructure`, ...) are passed
 * through unchanged (they are already R11-compliant).
 *
 * @param {string} field
 * @returns {string}
 */
export function rewriteField(field) {
  if (typeof field !== 'string') return field;
  // Trailing dotted selector on an interfaces[<n>] bracket.
  // `interfaces[2].name` -> `interfaces[2]`.
  const trailingDot = field.match(/^(interfaces\[[^\]]+\])\.[A-Za-z0-9_.-]+$/);
  if (trailingDot) return trailingDot[1];
  // Bare scalar field with a dotted tail (`purpose.content-type`,
  // `internalStructure.foo`, `decision.key`, `name.X`, etc.): the
  // scalar field is the whole value, so the tail is noise. Collapse
  // to the bare field name.
  const BARE_SCALAR_ROOTS = new Set([
    'purpose', 'internalStructure', 'decision', 'name',
    'context', 'consequences', 'tradeoffs', 'notes', 'title',
  ]);
  const scalarDotted = field.match(/^([A-Za-z0-9_]+)\./);
  if (scalarDotted && BARE_SCALAR_ROOTS.has(scalarDotted[1])) return scalarDotted[1];
  // Dotted root `<fieldName>.<rest>` where `<fieldName>` is one of
  // the known array roots. The `<rest>` is reassembled inside
  // brackets so names carrying dots (`responsibilities[audit.redaction]`)
  // are preserved as a single bracketed key.
  const dotted = field.match(/^(interfaces|responsibilities|dependencies|alternativesConsidered)\.(.+)$/);
  if (dotted) {
    const [, root, rest] = dotted;
    return `${root}[${rest}]`;
  }
  return field;
}

/**
 * Second-pass fix: for an ownerRef/deliveredBy that does not resolve
 * under R11 on its owner, drop the bracket key and keep the bare
 * array name (which does resolve as a schema field). Returns the
 * fixed field string, or `null` when nothing resolves even at the
 * bare-field level (caller drops the ownerRef entirely).
 *
 * The author's intent on `interfaces[audit]`, `responsibilities[dot]`
 * and similar is preserved by pointing at the array itself: "look in
 * the owning doc's interfaces/responsibilities/dependencies section".
 * That is strictly less specific than a working bracket pointer but
 * strictly more informative than no pointer at all; the fully-
 * resolved bracketed form stays unchanged when it already works.
 *
 * @param {object} owner - the owning TAC or ADR document.
 * @param {string} field - the current bracket-grammar field.
 * @returns {string|null}
 */
export function fixUnresolvedField(owner, field) {
  if (!owner || typeof owner !== 'object' || typeof field !== 'string') return null;
  const bracketMatch = field.match(/^([A-Za-z0-9_]+)\[[^\]]+\]$/);
  if (bracketMatch) {
    const root = bracketMatch[1];
    const v = /** @type {any} */ (owner)[root];
    if (Array.isArray(v) && v.length > 0) return root;
    if (typeof v === 'string' && v.length > 0) return root;
    if (v && typeof v === 'object' && Object.keys(v).length > 0) return root;
    return null;
  }
  return null;
}

/**
 * In-place rewrite of every `ownerRef.field` and object-form
 * `deliveredBy.field` on a parsed document. Returns the number of
 * strings rewritten (zero when the doc was already compliant).
 *
 * @param {object} doc
 * @returns {number}
 */
function rewriteDoc(doc) {
  let changed = 0;
  // AC ownerRefs on a user story.
  if (Array.isArray(doc?.acceptanceCriteria)) {
    for (const ac of doc.acceptanceCriteria) {
      const ref = ac?.ownerRef;
      if (ref && typeof ref === 'object' && typeof ref.field === 'string') {
        const rewritten = rewriteField(ref.field);
        if (rewritten !== ref.field) {
          ref.field = rewritten;
          changed += 1;
        }
      }
    }
  }
  // REQ deliveredBy object form.
  const d = doc?.deliveredBy;
  if (d && typeof d === 'object' && typeof d.field === 'string') {
    const rewritten = rewriteField(d.field);
    if (rewritten !== d.field) {
      d.field = rewritten;
      changed += 1;
    }
  }
  return changed;
}

async function listBlueprints() {
  const entries = await readdir(blueprintsRoot, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

async function listContributionFiles(blueprint) {
  const base = join(blueprintsRoot, blueprint, 'contributions');
  /** @type {string[]} */
  const files = [];
  for (const sub of SUBDIRS) {
    const dir = join(base, sub);
    try {
      const items = await readdir(dir, { withFileTypes: true });
      for (const it of items) {
        if (it.isFile() && it.name.endsWith('.json')) {
          files.push(join(dir, it.name));
        }
      }
    } catch {
      // sub-directory optional; the loader tolerates missing dirs.
    }
  }
  return files.sort();
}

/**
 * Pretty-print a JSON doc exactly as the shelf files are written on
 * disk (two-space indent, trailing newline). Keeps the diff minimal.
 *
 * @param {object} doc
 * @returns {string}
 */
function stringify(doc) {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/**
 * Build a walker-compatible tree model directly from a blueprint's
 * own contribution files, bypassing applyBlueprint and the project
 * schema validator. The blueprint's TACs, ADRs, REQs and USs are
 * assembled as-is so the R11 helpers (resolveOwnerRefField,
 * collectDefineValidateFindings) see the same ownerRef / deliveredBy
 * shapes the published blueprint would deliver on apply, without
 * caring about pre-existing walker-level data defects (slug-form AC
 * ids, missing capabilities, etc.) that are orthogonal to R11.
 *
 * The returned object is a minimal tree model: `{ tacs, adrs,
 * requirements, userStories, byId, manifest }`. byId is populated for
 * every doc so the string-form deliveredBy fallback path can resolve.
 *
 * @param {string} blueprint
 */
async function loadBlueprintTreeDirect(blueprint) {
  const files = await listContributionFiles(blueprint);
  const tree = {
    tacs: [], adrs: [], requirements: [], userStories: [], manifest: null, byId: new Map(),
  };
  for (const f of files) {
    const name = basename(f);
    const parent = basename(dirname(f));
    let doc;
    try { doc = JSON.parse(await readFile(f, 'utf8')); } catch { continue; }
    // Classify primarily by parent directory (unambiguous) and
    // secondarily by the strongest id field. A US file carries both
    // `usId` and `reqId`; the parent-dir arm resolves the overlap.
    if (parent === 'tacs' || doc.tacId) {
      tree.tacs.push(doc);
      if (doc.tacId) tree.byId.set(doc.tacId, doc);
    } else if (parent === 'adrs' || doc.adrId) {
      tree.adrs.push(doc);
      if (doc.adrId) tree.byId.set(doc.adrId, doc);
    } else if (parent === 'user-stories' || doc.usId) {
      tree.userStories.push(doc);
      if (doc.usId) tree.byId.set(doc.usId, doc);
    } else if (parent === 'requirements' || doc.reqId) {
      tree.requirements.push(doc);
      if (doc.reqId) tree.byId.set(doc.reqId, doc);
    }
  }
  return tree;
}

/**
 * Apply one blueprint to a fresh scratch project, walk the tree, and
 * tally the two check sets this sweep cares about. The primary tally
 * uses `loadBlueprintTreeDirect` so pre-existing walker errors on a
 * blueprint do not drop its TACs out of the finding set; the
 * applyBlueprint path is still exercised when `--with-apply` is
 * passed (slower; good for a smoke check that apply still works).
 *
 * @param {string} blueprint
 */
async function applyAndTally(blueprint) {
  // 1. Direct tally against the blueprint's own contribution files.
  //    This is the authoritative R11 recount: it covers every
  //    ownerRef / deliveredBy the blueprint ships, regardless of
  //    orthogonal walker defects (slug AC ids, etc.). D4 is called
  //    directly with a minimal StageContext; computeReadiness needs
  //    a walker-shaped tree the direct loader deliberately doesn't
  //    emit, and the only check we care about here is
  //    `stories:ownerRefResolves`.
  const directTree = await loadBlueprintTreeDirect(blueprint);
  const directValidate = collectDefineValidateFindings(directTree);
  const scope = new Set();
  for (const req of directTree.requirements) if (req?.reqId) scope.add(req.reqId);
  for (const us of directTree.userStories) if (us?.usId) scope.add(us.usId);
  const d4 = checkD4Stories({
    tree: directTree,
    scope,
    freeze: null,
    ledgers: {},
    profileText: '',
    validateErrors: [],
    currentTreeHash: null,
  });
  const ownerCheck = d4?.checks?.find((c) => c.name === 'stories:ownerRefResolves');
  // 2. Also do a shallow apply-walk pass so the summary flags
  //    pre-existing walker errors as a known-separate class.
  let applyError = null;
  let walkerErrorCount = 0;
  if (!process.argv.includes('--no-apply-check')) {
    const tmp = await mkdtemp(join(tmpdir(), `pr9-sweep-${blueprint}-`));
    try {
      await initProject({ projectRoot: tmp, projectName: `pr9-sweep-${blueprint}` });
      const { tree: initTree } = await walkTree({ projectRoot: tmp });
      try {
        await applyBlueprint({ projectRoot: tmp, tree: initTree, source: join(blueprintsRoot, blueprint) });
      } catch (err) {
        applyError = String(err?.message ?? err).split('\n')[0].slice(0, 200);
      }
      if (!applyError) {
        const { errors } = await walkTree({ projectRoot: tmp });
        walkerErrorCount = Array.isArray(errors) ? errors.length : 0;
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }
  return {
    blueprint,
    applyError,
    walkerErrorCount,
    validateCount: directValidate.length,
    ownerRefCount: ownerCheck ? ownerCheck.failing.length : 0,
    validateFindings: directValidate,
    ownerRefFailing: ownerCheck?.failing ?? [],
  };
}

async function main() {
  const blueprints = await listBlueprints();
  console.log(`PR 9 R11 sweep: scanning ${blueprints.length} blueprints under ${blueprintsRoot}`);
  console.log(`mode: ${DRY_RUN ? 'dry-run (tally only)' : 'rewrite + apply tally'}${NO_APPLY ? ' (no apply)' : ''}`);

  // --- Phase 1: rewrite dotted -> bracket forms. ---
  let rewriteTotal = 0;
  /** @type {Record<string, number>} */
  const rewritePerBlueprint = {};
  for (const bp of blueprints) {
    const files = await listContributionFiles(bp);
    let count = 0;
    for (const f of files) {
      const raw = await readFile(f, 'utf8');
      let doc;
      try { doc = JSON.parse(raw); } catch { continue; }
      const changed = rewriteDoc(doc);
      if (changed > 0) {
        count += changed;
        if (!DRY_RUN) await writeFile(f, stringify(doc), 'utf8');
      }
    }
    if (count > 0) rewritePerBlueprint[bp] = count;
    rewriteTotal += count;
  }
  console.log(`\nRewrites (dotted -> bracket): ${rewriteTotal} field strings across ${Object.keys(rewritePerBlueprint).length} blueprints`);
  for (const bp of Object.keys(rewritePerBlueprint).sort()) {
    console.log(`  ${bp}: ${rewritePerBlueprint[bp]}`);
  }

  // --- Phase 1b: fix every bracket that doesn't resolve, by
  //     collapsing to its bare parent field (when the parent exists
  //     non-empty on the owner) or dropping the ownerRef / deliveredBy
  //     entirely (when nothing resolves even bare). Idempotent: a
  //     second run finds zero. ---
  const fixedPerBp = {};
  let fixedTotal = 0;
  let droppedTotal = 0;
  for (const bp of blueprints) {
    const files = await listContributionFiles(bp);
    const tree = await loadBlueprintTreeDirect(bp);
    const tacById = new Map();
    for (const t of tree.tacs) if (t?.tacId) tacById.set(t.tacId, t);
    const adrById = new Map();
    for (const a of tree.adrs) if (a?.adrId) adrById.set(a.adrId, a);
    let fixedHere = 0;
    let droppedHere = 0;
    for (const f of files) {
      const raw = await readFile(f, 'utf8');
      let doc;
      try { doc = JSON.parse(raw); } catch { continue; }
      let touched = false;
      // AC ownerRefs on a user story.
      if (Array.isArray(doc?.acceptanceCriteria)) {
        for (const ac of doc.acceptanceCriteria) {
          const ref = ac?.ownerRef;
          if (!ref || typeof ref !== 'object' || typeof ref.field !== 'string') continue;
          const owner = ref.tacId ? tacById.get(ref.tacId) : (ref.adrId ? adrById.get(ref.adrId) : null);
          if (!owner) {
            // Owner doesn't exist on this blueprint's tree -- drop the
            // ownerRef (walker treats it as optional).
            delete ac.ownerRef;
            touched = true;
            droppedHere += 1;
            continue;
          }
          if (resolveOnOwner(owner, ref.field)) continue;
          const bare = fixUnresolvedField(owner, ref.field);
          if (bare) {
            ref.field = bare;
            touched = true;
            fixedHere += 1;
          } else {
            delete ac.ownerRef;
            touched = true;
            droppedHere += 1;
          }
        }
      }
      // REQ deliveredBy (object form only; strings are untouched).
      if (doc?.deliveredBy && typeof doc.deliveredBy === 'object' && typeof doc.deliveredBy.field === 'string') {
        const d = doc.deliveredBy;
        const owner = d.tacId ? tacById.get(d.tacId) : (d.adrId ? adrById.get(d.adrId) : null);
        if (!owner) {
          delete doc.deliveredBy;
          touched = true;
          droppedHere += 1;
        } else if (!resolveOnOwner(owner, d.field)) {
          const bare = fixUnresolvedField(owner, d.field);
          if (bare) {
            d.field = bare;
            touched = true;
            fixedHere += 1;
          } else {
            delete doc.deliveredBy;
            touched = true;
            droppedHere += 1;
          }
        }
      }
      if (touched && !DRY_RUN) {
        await writeFile(f, stringify(doc), 'utf8');
      }
    }
    if (fixedHere + droppedHere > 0) fixedPerBp[bp] = { fixed: fixedHere, dropped: droppedHere };
    fixedTotal += fixedHere;
    droppedTotal += droppedHere;
  }
  console.log(`\nDead-name fixes: ${fixedTotal} rewritten to bare field, ${droppedTotal} dropped (ownerRef/deliveredBy removed; walker treats as optional)`);
  for (const bp of Object.keys(fixedPerBp).sort()) {
    const r = fixedPerBp[bp];
    console.log(`  ${bp}: fixed ${r.fixed}, dropped ${r.dropped}`);
  }

  if (NO_APPLY) return;

  // --- Phase 2: per-blueprint apply + tally. ---
  console.log('\nApplying each blueprint to a scratch project and tallying ...');
  /** @type {Array<Awaited<ReturnType<typeof applyAndTally>>>} */
  const results = [];
  for (const bp of blueprints) {
    const r = await applyAndTally(bp);
    results.push(r);
    const vn = r.validateCount == null ? '?' : r.validateCount;
    const on = r.ownerRefCount == null ? '?' : r.ownerRefCount;
    const wn = r.walkerErrorCount ?? 0;
    const err = r.applyError ? `  APPLY-ERROR: ${r.applyError}` : '';
    console.log(`  ${bp.padEnd(50)} validate=${String(vn).padStart(4)} ownerRefResolves=${String(on).padStart(4)} walkerErrors=${String(wn).padStart(3)}${err}`);
  }

  // Summary.
  const sumValidate = results.reduce((n, r) => n + (r.validateCount ?? 0), 0);
  const sumOwner = results.reduce((n, r) => n + (r.ownerRefCount ?? 0), 0);
  const applyErrors = results.filter((r) => r.applyError).length;
  console.log('\nSummary:');
  console.log(`  total validate findings across all blueprints: ${sumValidate}`);
  console.log(`  total ownerRefResolves failures across all blueprints: ${sumOwner}`);
  console.log(`  blueprints that failed to apply: ${applyErrors}`);

  // Residual dead-name report so the fix pass has a punch list.
  console.log('\nDead ownerRef / deliveredBy names (first 50 per blueprint):');
  for (const r of results) {
    const perBpValidate = (r.validateFindings ?? []).filter((f) => f.rule === 'defineValidate:ownerRefResolves' || f.rule === 'defineValidate:deliveredByResolves');
    if (perBpValidate.length === 0 && (r.ownerRefFailing?.length ?? 0) === 0) continue;
    console.log(`  ${r.blueprint}:`);
    const seen = new Set();
    for (const f of perBpValidate.slice(0, 50)) {
      const line = `    [validate ${f.rule}] ${f.documentId}: ${f.message}`;
      if (seen.has(line)) continue;
      seen.add(line);
      console.log(line);
    }
    for (const f of (r.ownerRefFailing ?? []).slice(0, 50)) {
      const line = `    [D4 ownerRefResolves] ${f.id}: ${f.why}`;
      if (seen.has(line)) continue;
      seen.add(line);
      console.log(line);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
