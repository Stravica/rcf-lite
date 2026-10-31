// rcf/test-strength.json loader for `rcf audit test-strength` (FBS-236,
// TAC-4155, ADR-4156). The project declares its app entry, its shared
// harness and the module specifiers a test may mock (the network edge
// and the clock); the verb never guesses them, so a missing file or a
// malformed field exits 2 before any test runs.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CONFIG_FILE = 'rcf/test-strength.json';
export const ENTRY_KINDS = ['bin', 'module', 'worker'];
export const DEFAULT_RUNNER = ['node', '--test', '--test-reporter=tap', '--test-name-pattern', '<name>', '<file>'];
// RC-46 (US-19904, the stage-keeper's rulings Q3 and F2): each runners
// kind's default argv carries the reporter the audit reads; <report> is
// a per-run temp path the audit sets and reads.
export const RUNNER_KINDS = ['nodeTest', 'vitest', 'playwright'];
export const KIND_ARGV = {
  nodeTest: DEFAULT_RUNNER,
  vitest: ['vitest', 'run', '<file>', '-t', '<name>', '--reporter=json', '--outputFile=<report>'],
  playwright: ['playwright', 'test', '<file>', '-g', '<name>', '--reporter=json'],
};

const MISSING = `test-strength: no ${CONFIG_FILE}; declare entry and harness`;

/**
 * A project-relative glob ("**" spans directories, "*" and "?" stay
 * inside one segment) as an anchored RegExp.
 *
 * @param {string} glob
 * @returns {RegExp}
 */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      i += 1;
      if (glob[i + 1] === '/') { i += 1; re += '(?:.*/)?'; } else re += '.*';
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

const strings = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string' && s.trim() !== '');

/**
 * Load and check rcf/test-strength.json from the project root.
 *
 * @param {string} projectRoot
 * @returns {{ ok: true, config: { entry: Array<{ kind: string, path: string }>, harness: string[], harnessRe: RegExp[],
 *   edge: string[], clock: string[], runner: string[]|null,
 *   runners: Array<{ kind: string, argv: string[]|null, filesRe: RegExp[] }> } } | { ok: false, line: string }}
 */
export function loadConfig(projectRoot) {
  const abs = join(projectRoot, CONFIG_FILE);
  if (!existsSync(abs)) return { ok: false, line: MISSING };
  const bad = (detail) => ({ ok: false, line: `test-strength: malformed ${CONFIG_FILE}: ${detail}` });
  let doc;
  try {
    doc = JSON.parse(readFileSync(abs, 'utf8'));
  } catch (err) {
    return bad(`not JSON (${err.message})`);
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return bad('the file must hold one JSON object');
  if (!Array.isArray(doc.entry) || doc.entry.length === 0) return bad('entry must list one or more { kind, path }');
  for (const [i, e] of doc.entry.entries()) {
    if (!e || typeof e !== 'object') return bad(`entry[${i}] must be an object { kind, path }`);
    if (!ENTRY_KINDS.includes(e.kind)) return bad(`entry[${i}].kind ${JSON.stringify(e.kind)} is not ${ENTRY_KINDS.join(', ')}`);
    if (typeof e.path !== 'string' || e.path.trim() === '') return bad(`entry[${i}].path must be a repo-relative path`);
  }
  if (!strings(doc.harness) || doc.harness.length === 0) return bad('harness must list one or more globs');
  for (const field of ['edge', 'clock']) {
    if (doc[field] !== undefined && !strings(doc[field])) return bad(`${field} must list module specifiers`);
  }
  if (doc.runner !== undefined && (!strings(doc.runner) || doc.runner.length === 0 || !doc.runner.some((a) => a.includes('<file>')))) {
    return bad('runner must be an argv list holding a <file> placeholder');
  }
  if (doc.runners !== undefined && !Array.isArray(doc.runners)) return bad('runners must list { files, kind, argv } entries');
  for (const [i, r] of (doc.runners ?? []).entries()) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return bad(`runners[${i}] must be an object { files, kind, argv }`);
    if (!strings(r.files) || r.files.length === 0) return bad(`runners[${i}].files must list one or more globs`);
    if (!RUNNER_KINDS.includes(r.kind)) return bad(`runners[${i}].kind ${JSON.stringify(r.kind)} is not ${RUNNER_KINDS.join(', ')}`);
    if (r.argv !== undefined && (!strings(r.argv) || r.argv.length === 0 || !r.argv.some((a) => a.includes('<file>') || a.includes('<name>')))) {
      return bad(`runners[${i}].argv must be an argv list holding a <file> or <name> placeholder`);
    }
  }
  if (doc.suiteCommand !== undefined && typeof doc.suiteCommand !== 'string') return bad('suiteCommand must be a string');
  return {
    ok: true,
    config: {
      entry: doc.entry.map((e) => ({ kind: e.kind, path: e.path.replace(/^\.\//, '') })),
      harness: doc.harness,
      harnessRe: doc.harness.map(globToRegExp),
      edge: doc.edge ?? [],
      clock: doc.clock ?? [],
      runner: doc.runner ?? null,
      runners: (doc.runners ?? []).map((r) => ({ kind: r.kind, argv: r.argv ?? null, filesRe: r.files.map(globToRegExp) })),
    },
  };
}

/**
 * The runner of one bound test file (AC-19904-3): the first runners
 * entry whose files glob matches it, else the legacy runner (judged by
 * its exit code, as before RC-46), else kind nodeTest. `matched` is
 * false when no runners entry matched; `override` is true when the argv
 * is the project's own rather than the kind's default.
 *
 * @param {{ runner: string[]|null, runners: Array<{ kind: string, argv: string[]|null, filesRe: RegExp[] }> }} config
 * @param {string} file - project-relative path
 * @returns {{ kind: 'nodeTest'|'vitest'|'playwright'|'legacy', argv: string[], matched: boolean, override: boolean }}
 */
export function runnerFor(config, file) {
  const hit = config.runners.find((r) => r.filesRe.some((re) => re.test(file)));
  if (hit) return { kind: hit.kind, argv: hit.argv ?? KIND_ARGV[hit.kind], matched: true, override: Boolean(hit.argv) };
  if (config.runner) return { kind: 'legacy', argv: config.runner, matched: false, override: true };
  return { kind: 'nodeTest', argv: DEFAULT_RUNNER, matched: false, override: false };
}
