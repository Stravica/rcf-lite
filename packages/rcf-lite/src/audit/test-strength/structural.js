// The structural check of `rcf audit test-strength` (FBS-236, US-19901,
// TAC-4155, ADR-4156): static, over text. A bound test file may import a
// Node builtin, a third-party package, the declared harness or the app
// entry, and nothing else of the product; it may mock only a declared
// edge or clock specifier; and a Code Node symbol may not give a logger,
// emitter or sender parameter a default (a silent default). Nothing is
// imported or executed: a test file that would throw on import is read
// like any other.

import { isBuiltin } from 'node:module';
import { posix } from 'node:path';

import { defaultedParams, findDeclaration, importSpecifiers, mockedModules, parseSource } from './source.js';

// ADR-4156: the parameter and option names a silent default hides.
export const SILENT_NAMES = new Set(['logger', 'log', 'emitter', 'events', 'sender', 'mailer', 'notifier']);

const RESOLVE_SUFFIXES = ['', '.js', '.mjs', '.cjs', '/index.js', '/index.mjs', '/index.cjs'];

/** The first string target of a package.json exports or imports value. */
function target(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const cond of ['node', 'import', 'require', 'default']) {
      const t = target(value[cond]);
      if (t) return t;
    }
  }
  return null;
}

/** Look a subpath up in an exports or imports map, "*" patterns included. */
function mapLookup(map, key) {
  if (!map || typeof map !== 'object') return null;
  if (key in map) return target(map[key]);
  for (const [k, v] of Object.entries(map)) {
    const star = k.indexOf('*');
    if (star < 0) continue;
    const pre = k.slice(0, star);
    const post = k.slice(star + 1);
    if (key.startsWith(pre) && key.endsWith(post) && key.length >= pre.length + post.length) {
      const t = target(v);
      if (t) return t.replace('*', key.slice(pre.length, key.length - post.length));
    }
  }
  return null;
}

/** A project-relative path, completed with the first suffix the HEAD tree holds. */
function complete(path, files) {
  const p = posix.normalize(path).replace(/^\.\//, '');
  return RESOLVE_SUFFIXES.map((s) => p + s).find((c) => files.has(c)) ?? p;
}

/**
 * Where an import specifier in a bound test file leads: a builtin, an
 * external package, or a project path (relative imports, the package's
 * own name through its exports map, and #subpath imports).
 *
 * @param {string} spec
 * @param {string} fromFile - project-relative path of the importing file
 * @param {{ files: Set<string>, pkg: object|null }} ctx
 * @returns {{ kind: 'builtin'|'external'|'project', path?: string }}
 */
export function resolveImport(spec, fromFile, { files, pkg }) {
  if (isBuiltin(spec)) return { kind: 'builtin' };
  if (spec.startsWith('.') || spec.startsWith('/')) {
    return { kind: 'project', path: complete(posix.join(posix.dirname(fromFile), spec), files) };
  }
  if (spec.startsWith('#')) {
    const t = mapLookup(pkg?.imports, spec);
    return { kind: 'project', path: t ? complete(t, files) : spec };
  }
  const segs = spec.split('/');
  const name = spec.startsWith('@') ? segs.slice(0, 2).join('/') : segs[0];
  if (!pkg || pkg.name !== name) return { kind: 'external' };
  const sub = spec.slice(name.length);
  const exp = pkg.exports;
  let t = null;
  if (typeof exp === 'string' || (exp && typeof exp === 'object' && !Object.keys(exp).some((k) => k.startsWith('.')))) {
    if (!sub) t = target(exp);
  } else if (exp) {
    t = mapLookup(exp, `.${sub}`);
  } else if (!sub) {
    t = typeof pkg.main === 'string' ? pkg.main : 'index.js';
  }
  return { kind: 'project', path: t ? complete(t, files) : spec };
}

const bareBuiltin = (spec) => (isBuiltin(spec) ? spec.replace(/^node:/, '') : spec);

/**
 * Structural findings for one bound test file: each import of a product
 * file that is neither the entry nor the harness, and each module mock
 * outside the declared edge and clock.
 *
 * @param {string} file - project-relative path
 * @param {string} text
 * @param {{ config: object, files: Set<string>, pkg: object|null }} ctx
 * @returns {string[]}
 */
export function testFileFindings(file, text, { config, files, pkg }) {
  const src = parseSource(text);
  const entries = new Set(config.entry.map((e) => posix.normalize(e.path)));
  const findings = [];
  for (const spec of importSpecifiers(src)) {
    const r = resolveImport(spec, file, { files, pkg });
    if (r.kind !== 'project') continue;
    if (entries.has(r.path) || config.harnessRe.some((re) => re.test(r.path))) continue;
    findings.push(`imports ${r.path} (not the app entry or the harness)`);
  }
  const allowed = new Set([...config.edge, ...config.clock].map(bareBuiltin));
  for (const spec of mockedModules(src)) {
    if (!allowed.has(bareBuiltin(spec))) findings.push(`mocks ${spec} (not a declared edge)`);
  }
  return findings;
}

/**
 * Silent-default findings for one symbol-level Code Node: a parameter or
 * destructured option named in SILENT_NAMES that has a default value, in
 * the function the symbol names or in any method (constructor included)
 * of the class it names.
 *
 * @param {string} cnPath - "<path>#<symbol>"
 * @param {string} text - the file's source
 * @returns {string[]}
 */
export function silentDefaults(cnPath, text) {
  const symbol = cnPath.slice(cnPath.indexOf('#') + 1);
  const [head, member] = symbol.split('.');
  const src = parseSource(text);
  const decl = findDeclaration(src, head);
  if (!decl) return [];
  let fns = [];
  if (decl.kind === 'function') fns = member ? [] : [decl];
  else if (decl.kind === 'class') fns = decl.methods.filter((m) => !member || m.name === member);
  const names = [];
  for (const fn of fns) {
    if (!fn.params) continue;
    for (const { name, key } of defaultedParams(src, fn.params)) {
      const hit = SILENT_NAMES.has(name) ? name : (key && SILENT_NAMES.has(key) ? key : null);
      if (hit && !names.includes(hit)) names.push(hit);
    }
  }
  return names.map((n) => `silent default ${n} in ${cnPath}`);
}
