// Shared test harness (GR-40): capture helpers. The spawn log seam
// (TAC-4153 "Spawn log seam", GR-46), host facts for timing tests
// (GR-45), TAP files for verdict fixtures and parsing of captured output.
// Imports Node builtins only.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { join } from 'node:path';

/** The env entry that turns the spawn log seam on, and the file it writes. */
export function spawnLog(dir, name = 'spawn.log') {
  const file = join(dir, name);
  return { file, env: { RCF_SPAWN_LOG: file } };
}

/** The recorded child processes: [{ command, args }] (empty when the file is absent). */
export function readSpawnLog(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

/** The basename of a recorded command (git, /usr/bin/git, node ...). */
export function commandName(entry) {
  return String(entry.command).split(/[\\/]/).pop();
}

/** Print and return the host facts a timing assertion is made on (GR-45). */
export function hostFacts(t) {
  const facts = { cpus: cpus().length, node: process.version };
  const line = `host: os.cpus().length ${facts.cpus}, process.version ${facts.node}`;
  if (t && typeof t.diagnostic === 'function') t.diagnostic(line);
  console.log(line);
  return facts;
}

/**
 * Write a node:test-style TAP file: one "ok"/"not ok" line per named test
 * and the summary block node --test prints.
 * tests: [{ name, ok = true, directive = null ('SKIP' | 'TODO') }]
 */
export function writeTap(file, tests, { summary = true } = {}) {
  const out = ['TAP version 13'];
  tests.forEach((x, i) => {
    out.push(`# Subtest: ${x.name}`);
    const dir = x.directive ? ` # ${x.directive}` : '';
    out.push(`${x.ok === false ? 'not ok' : 'ok'} ${i + 1} - ${x.name}${dir}`);
    out.push('  ---', '  duration_ms: 1.0', "  type: 'test'", '  ...');
  });
  out.push(`1..${tests.length}`);
  if (summary) {
    const pass = tests.filter((x) => x.ok !== false && !x.directive).length;
    const fail = tests.filter((x) => x.ok === false && !x.directive).length;
    const skip = tests.filter((x) => x.directive === 'SKIP').length;
    const todo = tests.filter((x) => x.directive === 'TODO').length;
    out.push(`# tests ${tests.length}`, '# suites 0', `# pass ${pass}`, `# fail ${fail}`, '# cancelled 0', `# skipped ${skip}`, `# todo ${todo}`, '# duration_ms 10.0');
  }
  writeFileSync(file, `${out.join('\n')}\n`);
  return file;
}

/** The one line of text matching re, or null. */
export function lineMatching(text, re) {
  return text.split('\n').find((l) => re.test(l)) ?? null;
}

/** Parse stdout as JSON, failing with the text when it is not JSON. */
export function json(text) {
  try { return JSON.parse(text); } catch { throw new Error(`expected JSON on stdout, got:\n${text.slice(0, 2000)}`); }
}

/** Median of numbers. */
export function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
