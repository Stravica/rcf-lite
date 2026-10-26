// `rcf audit test-strength` core (FBS-236, US-19901 to US-19903,
// TAC-4155, ADR-4156). Proves a touched criterion's bound tests are real
// in two layers:
//
//   structural   static, over text (structural.js): bound tests import
//                only builtins, packages, the declared harness and the
//                app entry; module mocks only at the declared edge and
//                clock; no silent logger, emitter or sender default in a
//                Code Node symbol
//   mutation     for criteria that pass it (mutants.js, runner.js):
//                stubToThrow, noOp and callRemoval on each symbol-level
//                Code Node, fileBlank on each file-level Code Node of a
//                non-source path, in scratch worktrees of HEAD; at least
//                one bound test must go red for each mutant
//
// Scope (TAC-4155): --acs, else the touchedAcIds of the newest REVIEW
// verdict reachable from HEAD, else the --fbs acIds. With --record the
// TestStrengthReport v1 is written to rcf/verdicts/<H12>/test-strength.json
// for the reviewed head H, beside the TEST verdict. Sources are read at
// HEAD through git; the project's working tree is written only by
// --record, and never deployed, served or networked.

import { mkdirSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join, posix } from 'node:path';

import { CLASS_OWNERS, classifyPath, readObjects, runGit } from '../separation.js';
import { verdictFile } from '../../build/verdict.js';
import { loadConfig } from './config.js';
import { CODE_EXT, SOURCE_EXT, criterionMutants, splitNode } from './mutants.js';
import { runMutants } from './runner.js';
import { silentDefaults, testFileFindings } from './structural.js';

export const DEFAULT_MAX_MUTANTS = 200;
export const DEFAULT_MUTANT_TIMEOUT_S = 120;
/** --jobs default: half the CPU count, at least 1. */
export const defaultJobs = () => Math.max(1, Math.floor(availableParallelism() / 2));

const FINALISE_CLASSES = new Set(Object.entries(CLASS_OWNERS).filter(([, owners]) => owners.includes('FINALISE')).map(([cls]) => cls));
const TEST_CLASSES = new Set(['rcfTest', 'hygieneTest']);
const s7 = (sha) => String(sha ?? '').slice(0, 7);

/** True for a path inside rcf/verdicts/ or rcf/verify-reports/ at any depth. */
function verdictOrEvidence(path) {
  const segs = path.split('/');
  const at = segs.indexOf('rcf');
  return at !== -1 && (segs[at + 1] === 'verdicts' || segs[at + 1] === 'verify-reports') && segs.length > at + 2;
}

/**
 * The newest ReviewVerdict v1 reachable from HEAD: the commits adding
 * rcf/verdicts/<h12>/review.json, newest first, each read at HEAD (the
 * reader `rcf build verdict test` uses, without its FBS filter). Null
 * when there is none.
 */
async function newestReviewVerdict(git) {
  const log = await git(['log', '--topo-order', '--relative', '--diff-filter=A', '--name-only', '--format=', 'HEAD', '--', 'rcf/verdicts/']);
  if (log.code !== 0) return null;
  const paths = [...new Set(log.stdout.split('\n').filter((p) => /^rcf\/verdicts\/[0-9a-f]{12}\/review\.json$/.test(p)))];
  if (!paths.length) return null;
  for (const blob of await readObjects(git, paths.map((p) => `HEAD:./${p}`))) {
    if (blob.missing) continue;
    let doc;
    try { doc = JSON.parse(blob.text); } catch { continue; }
    if (doc && typeof doc.head === 'string' && Array.isArray(doc.touchedAcIds)) return doc;
  }
  return null;
}

/** True when the working tree has any change (untracked included) outside rcf/verdicts/. */
async function dirtyTree(git) {
  const status = await git(['status', '--porcelain', '-z', '--untracked-files=all']);
  const entries = status.stdout.split('\0');
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (entry.length < 4) continue;
    if (entry[0] === 'R' || entry[0] === 'C') i += 1;
    const segs = entry.slice(3).split('/');
    const at = segs.indexOf('rcf');
    if (!(at !== -1 && segs[at + 1] === 'verdicts')) return true;
  }
  return false;
}

/** Every acceptance criterion id in the chain. */
function chainAcIds(tree) {
  const ids = new Set();
  for (const us of tree.userStories ?? []) for (const ac of us.acceptanceCriteria ?? []) if (ac?.id) ids.add(ac.id);
  return ids;
}

/** A criterion's bound tests, one per distinct test pointer "<file>::<name>". */
function boundTests(tree, acId) {
  const out = [];
  const seen = new Set();
  for (const { tsId, tcId } of tree.tcsByAcId?.get(acId) ?? []) {
    const tc = (tree.byId?.get(tsId)?.testCases ?? []).find((c) => c?.id === tcId);
    const pointer = typeof tc?.testPointer === 'string' ? tc.testPointer : null;
    const sep = pointer ? pointer.indexOf('::') : -1;
    if (sep < 0 || seen.has(pointer)) continue;
    seen.add(pointer);
    out.push({ file: posix.normalize(pointer.slice(0, sep)).replace(/^\.\//, ''), name: pointer.slice(sep + 2), pointer });
  }
  return out;
}

/** A criterion's Code Nodes, one per distinct path, in id order. */
function codeNodesOf(tree, acId) {
  const seen = new Set();
  return (tree.codeNodes ?? []).filter((cn) => {
    if (!(cn.implementsAcIds ?? []).includes(acId) || typeof cn.path !== 'string' || seen.has(cn.path)) return false;
    seen.add(cn.path);
    return true;
  });
}

const fail = (code, ...err) => ({ code, out: null, err, report: null });

/**
 * Resolve the scope, run both layers and (with record) write the report.
 *
 * @param {{ projectRoot: string, tree: object, acs?: string[]|null, fbs?: string[]|null, record?: boolean,
 *   jobs?: number, mutantTimeoutS?: number, maxMutants?: number, deps?: object }} opts
 * @returns {Promise<{ code: number, out: string|null, err: string[], report: object|null }>}
 */
export async function auditTestStrength({
  projectRoot, tree, acs = null, fbs = null, record = false,
  jobs = defaultJobs(), mutantTimeoutS = DEFAULT_MUTANT_TIMEOUT_S, maxMutants = DEFAULT_MAX_MUTANTS, deps = {},
}) {
  const t0 = Date.now();
  const loaded = loadConfig(projectRoot);
  if (!loaded.ok) return fail(2, loaded.line);
  const { config } = loaded;

  const git = (args, input = null) => runGit(args, { cwd: projectRoot, deps, input });
  const rev = await git(['rev-parse', 'HEAD', '--show-toplevel', '--show-prefix']);
  if (rev.code !== 0) return fail(2, 'test-strength: not a git repository with a commit; mutants run in a scratch worktree of HEAD');
  const [head, toplevel, prefix = ''] = rev.stdout.split('\n');

  // --record names a reviewed head: it needs a REVIEW verdict, a clean
  // tree, and nothing changed since H outside verdicts, evidence and
  // FINALISE classes.
  const review = await newestReviewVerdict(git);
  if (record) {
    if (!review) return fail(2, 'test-strength: --record needs a REVIEW verdict reachable from HEAD');
    if (await dirtyTree(git)) return fail(4, 'test-strength: refused: working tree is dirty; a record names a committed head');
    if (review.head !== head) {
      const diff = await git(['diff', '--name-only', '-z', '--no-renames', review.head, head]);
      const changed = diff.code === 0 ? diff.stdout.split('\0').filter(Boolean) : null;
      if (!changed || changed.some((p) => !verdictOrEvidence(p) && !FINALISE_CLASSES.has(classifyPath(p)))) {
        return fail(4, `test-strength: refused: HEAD differs from the reviewed head ${s7(review.head)} outside rcf/verdicts/, rcf/verify-reports/ and FINALISE classes`);
      }
    }
  }

  // Scope: --acs, else the newest REVIEW verdict, else --fbs.
  let scope;
  let ids;
  if (acs?.length) {
    scope = 'acs';
    ids = acs;
  } else if (review) {
    scope = 'reviewVerdict';
    ids = review.touchedAcIds;
  } else if (fbs?.length) {
    const byId = new Map((tree.fbsItems ?? []).map((f) => [f.fbsId, f]));
    const unknown = fbs.filter((id) => !byId.has(id));
    if (unknown.length) return fail(2, ...unknown.map((id) => `test-strength: unknown FBS ${id}`));
    scope = 'fbs';
    ids = fbs.flatMap((id) => byId.get(id).acIds ?? []);
  } else {
    return fail(2, 'test-strength: no scope; pass --acs or --fbs, or record a REVIEW verdict');
  }
  ids = [...new Set(ids)];
  const known = chainAcIds(tree);
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length) return fail(2, ...unknown.map((id) => `test-strength: unknown criterion ${id}`));
  const reportHead = scope === 'reviewVerdict' || record ? review.head : head;

  const criteria = ids.map((acId) => ({ acId, tests: boundTests(tree, acId), nodes: codeNodesOf(tree, acId) }));

  // Supported sources: JavaScript ESM and CommonJS only.
  const unsupported = new Set();
  for (const c of criteria) {
    for (const t of c.tests) if (!SOURCE_EXT.test(t.file)) unsupported.add(t.file);
    for (const n of c.nodes) {
      const { file, symbol } = splitNode(n.path);
      if (symbol ? !SOURCE_EXT.test(file) : CODE_EXT.test(file)) unsupported.add(file);
    }
  }
  if (unsupported.size) return fail(2, ...[...unsupported].map((p) => `test-strength: ${p} is not a supported source (JavaScript ESM or CommonJS)`));

  // Everything is read at HEAD, as text.
  const tree0 = await git(['ls-tree', '-r', '--name-only', 'HEAD']);
  const files = new Set(tree0.stdout.split('\n').filter(Boolean));
  const wanted = [...new Set(['package.json', ...criteria.flatMap((c) => [...c.tests.map((t) => t.file), ...c.nodes.map((n) => splitNode(n.path).file)])])];
  const texts = new Map();
  (await readObjects(git, wanted.map((p) => `HEAD:./${p}`))).forEach((blob, i) => texts.set(wanted[i], blob.missing ? null : blob.text));
  for (const c of criteria) {
    for (const t of c.tests) if (typeof texts.get(t.file) !== 'string') return fail(2, `test-strength: bound test ${t.file} of ${c.acId} is not committed at ${s7(head)}`);
  }
  let pkg = null;
  try { pkg = texts.get('package.json') ? JSON.parse(texts.get('package.json')) : null; } catch { pkg = null; }

  // Layer 1, structural, for every criterion first.
  for (const c of criteria) {
    const findings = [];
    for (const file of [...new Set(c.tests.map((t) => t.file))]) findings.push(...testFileFindings(file, texts.get(file), { config, files, pkg }));
    for (const n of c.nodes) {
      const { file, symbol } = splitNode(n.path);
      if (symbol && typeof texts.get(file) === 'string') findings.push(...silentDefaults(`${file}#${symbol}`, texts.get(file)));
    }
    c.structural = { result: findings.length ? 'fail' : 'pass', findings: [...new Set(findings)] };
  }

  // Layer 2, the mutants of the criteria that pass it.
  let sourceCache = null;
  const sources = async () => {
    if (sourceCache) return sourceCache;
    const paths = [...files].filter((p) => SOURCE_EXT.test(p) && !p.split('/').includes('node_modules') && !TEST_CLASSES.has(classifyPath(p))
      && !config.harnessRe.some((re) => re.test(p)));
    sourceCache = new Map();
    (await readObjects(git, paths.map((p) => `HEAD:./${p}`))).forEach((blob, i) => { if (!blob.missing) sourceCache.set(paths[i], blob.text); });
    return sourceCache;
  };
  const parsed = new Map();
  for (const c of criteria) {
    c.reasons = c.structural.findings.slice();
    c.mutants = [];
    if (c.structural.result === 'fail') continue;
    if (!c.nodes.length) c.reasons.push('no Code Node');
    if (!c.tests.length) c.reasons.push('unbound');
    if (!c.nodes.length) continue;
    const built = await criterionMutants(c.nodes, { texts, sources, parsed });
    if (!built.symbolLevel && built.fileLevelSource) c.reasons.push('no symbol-level Code Node');
    c.reasons.push(...built.unmutable.map((p) => `no mutable symbol ${p}`));
    for (const m of built.mutants) {
      if (m.operator === 'fileBlank' && typeof texts.get(m.symbol) !== 'string') { c.reasons.push(`no mutable symbol ${m.symbol}`); continue; }
      c.mutants.push(m);
    }
    if (!c.tests.length) c.mutants = [];
  }

  const total = criteria.reduce((n, c) => n + c.mutants.length, 0);
  if (total > maxMutants) return fail(2, `test-strength: ${total} mutants exceed --max-mutants ${maxMutants}; narrow the scope`);

  const runnable = criteria.flatMap((c) => c.mutants.filter((m) => !m.result).map((m) => Object.assign(m, { tests: c.tests })));
  let run;
  try {
    run = await runMutants({ git, mutants: runnable, jobs, timeoutMs: mutantTimeoutS * 1000, runner: config.runner, head, toplevel, prefix });
  } catch (err) {
    return fail(2, `test-strength: cannot run the bound tests: ${err.message}`);
  }
  runnable.forEach((m, i) => Object.assign(m, run.results[i]));
  const warn = run.left.map((dir) => `[warn] test-strength: scratch worktree ${dir} could not be removed`);

  // The report (TestStrengthReport v1) and the verdict line.
  const totals = { criteria: criteria.length, structuralPassed: 0, mutants: total, killed: 0, survived: 0, timeout: 0, notApplicable: 0 };
  const items = [];
  const out = criteria.map((c) => {
    if (c.structural.result === 'pass') totals.structuralPassed += 1;
    for (const m of c.mutants) {
      totals[m.result] += 1;
      if (m.result === 'survived') c.reasons.push(`vacuous: ${m.operator} on ${m.symbol} survived ${c.tests.length} bound tests`);
    }
    items.push(...c.reasons.map((r) => `${c.acId} ${r}`));
    return {
      acId: c.acId,
      structural: c.structural,
      mutants: c.mutants.map((m) => ({ symbol: m.symbol, operator: m.operator, result: m.result, killedBy: m.killedBy ?? [] })),
      result: c.reasons.length ? 'fail' : 'pass',
    };
  });
  const failing = out.filter((c) => c.result === 'fail').length;
  const report = {
    version: 1,
    head: reportHead,
    scope,
    criteria: out,
    result: failing ? 'fail' : 'pass',
    totals,
    wallMs: Date.now() - t0,
    node: process.version,
  };
  const line = failing
    ? `test-strength: FAIL ${failing} of ${out.length} criteria at ${s7(reportHead)}: ${items.join('; ')}`
    : `test-strength: PASS ${out.length} criteria at ${s7(reportHead)}: structural ${totals.structuralPassed}/${out.length}, mutants killed ${totals.killed + totals.timeout}/${total - totals.notApplicable} (timeout ${totals.timeout}, notApplicable ${totals.notApplicable})`;
  if (record) {
    const abs = join(projectRoot, verdictFile(reportHead, 'test-strength.json'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, `${JSON.stringify(report, null, 2)}\n`);
  }
  return { code: failing ? 4 : 0, out: line, err: warn, report };
}
