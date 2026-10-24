// Shared test harness (GR-40): scratch directories and fixture projects.
// A fixture project is made by the app entry itself (rcf init, then
// rcf discover journey declare --ui none so chain writes pass D0), built
// once per test file and copied per test. Fixture chain records are then
// shaped by writing their JSON in the scratch copy. Imports Node builtins
// and the harness only; nothing under src/ or test/_helpers/.

import { after } from 'node:test';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { rcfOk, PACKAGE_ROOT } from './spawn.js';
import { initRepo, commit } from './git.js';

const here = dirname(fileURLToPath(import.meta.url));
const made = new Set();
after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

/**
 * A fresh scratch directory under the OS temp dir, removed after the test
 * (t given) or after the file (t omitted).
 */
export function scratch(t, prefix = 'rcf-h-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  if (t && typeof t.after === 'function') t.after(() => rmSync(dir, { recursive: true, force: true }));
  else made.add(dir);
  return dir;
}

/**
 * The repository checkout this test reads for testOnly criteria (GR-34):
 * RCF_CHECKOUT when set (the verifier exports it for a Test-stage report
 * run inside the installed copy), else the repository root above this
 * file (packages/rcf-lite/test/_harness -> the repository root).
 */
export function checkoutRoot() {
  return process.env.RCF_CHECKOUT ? resolve(process.env.RCF_CHECKOUT) : resolve(here, '..', '..', '..', '..');
}
/** packages/rcf-lite inside the checkout. */
export function checkoutPackage() {
  return join(checkoutRoot(), 'packages', 'rcf-lite');
}

export function readJson(dir, rel) {
  return JSON.parse(readFileSync(join(dir, rel), 'utf8'));
}
export function writeJson(dir, rel, value) {
  const abs = join(dir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, `${JSON.stringify(value, null, 2)}\n`);
}
export function readText(dir, rel) {
  return readFileSync(join(dir, rel), 'utf8');
}
export function writeText(dir, rel, text) {
  const abs = join(dir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}

let template = null;
/** Build (once per file) a project with rcf init and D0 declared none. */
async function projectTemplate() {
  if (template) return template;
  const dir = join(scratch(null, 'rcf-h-tpl-'), 'project');
  mkdirSync(dir, { recursive: true });
  writeJson(dir, 'package.json', { name: 'fixture-app', version: '1.0.0', type: 'module', private: true });
  await rcfOk(['init', '--non-interactive', '--no-agent-setup'], { cwd: dir });
  await rcfOk(['discover', 'journey', 'declare', '--ui', 'none', '--reason', 'fixture: D0 not under test'], { cwd: dir });
  template = dir;
  return dir;
}

/**
 * A fixture project in a fresh scratch directory: the rcf init tree with
 * US-101 (AC-101-1), FBS-001 scoping it, and package.json. With
 * { git: true } it is also a git repository with one base commit.
 */
export async function project(t, { git = false, name = 'p' } = {}) {
  const tpl = await projectTemplate();
  const dir = join(scratch(t, `rcf-h-${name}-`), 'project');
  cpSync(tpl, dir, { recursive: true });
  if (git) {
    initRepo(dir);
    commit(dir, 'fixture: base');
  }
  return dir;
}

/** Edit a user story (by id) in a fixture project. */
export function editStory(dir, usId, fn) {
  const rel = `rcf/user-stories/${usId.toLowerCase()}.json`;
  const doc = readJson(dir, rel);
  const next = fn(doc) ?? doc;
  writeJson(dir, rel, next);
  return next;
}

/** Edit an FBS (by id) in a fixture project. */
export function editFbs(dir, fbsId, fn) {
  const rel = `rcf/fbs/${fbsId.toLowerCase()}.json`;
  const doc = existsSync(join(dir, rel)) ? readJson(dir, rel) : null;
  const next = fn(doc) ?? doc;
  writeJson(dir, rel, next);
  return next;
}

/** A criterion object in the shape the chain stores. */
export function criterion(id, description, extra = {}) {
  return { id, description, testable: true, ...extra };
}

/**
 * Write a test suite under US-101 (or usId) binding each { acId, pointer }
 * case, and (with realTests) a test file per pointer holding a test of
 * that name, so the pointer resolves.
 */
export function bindTests(dir, cases, { tsId = 'TS-001', usId = 'US-101', testLevel = 'e2e', realTests = true } = {}) {
  const ts = {
    id: tsId, usId, status: 'draft', title: `${usId} fixture suite`, purpose: 'fixture', testLevel,
    acIds: [...new Set(cases.map((c) => c.acId))],
    testCases: cases.map((c, i) => ({
      id: c.tcId ?? `TC-${tsId.slice(3)}-case-${i + 1}`, acId: c.acId, description: c.description ?? `case ${i + 1}`,
      status: 'pending', testPointer: c.pointer,
    })),
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  };
  writeJson(dir, `rcf/test-suites/${tsId.toLowerCase()}.json`, ts);
  if (realTests) {
    const byFile = new Map();
    for (const c of cases) {
      const [file, name] = c.pointer.split('::');
      if (!byFile.has(file)) byFile.set(file, []);
      byFile.get(file).push({ name, body: c.body ?? '' });
    }
    for (const [file, tests] of byFile) {
      writeText(dir, file, `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\n${tests.map((x) => `test(${JSON.stringify(x.name)}, () => { ${x.body} });`).join('\n')}\n`);
    }
  }
  return ts;
}

export { PACKAGE_ROOT };
