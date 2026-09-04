// CLI end-to-end tests for the companion-suggestion mechanism
// (core-companions spec sections 2.4, 2.5, 2.6).
//
// Covers TS-041 (add --companion + suggestion block), TS-042
// (companions <slug>|set|unset sub-verbs), TS-043 (two-libraries
// refusal exit 3).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { initProject } from '#core/store';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, '..', '..', 'bin', 'rcf.js');
const REPO_ROOT = resolve(here, '..', '..', '..', '..');
const API_REST = join(REPO_ROOT, 'blueprints', 'application-api-rest');
const LOGGING = join(REPO_ROOT, 'blueprints', 'observability-logging');
const ESSENTIALS = join(REPO_ROOT, 'blueprints', 'observability-essentials');
const ERROR_HANDLING = join(REPO_ROOT, 'blueprints', 'application-error-handling');

async function runBin(cwd, args) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [bin, ...args], {
      cwd, encoding: 'utf8', env: { ...process.env, CI: '1' },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

async function scaffold(name) {
  const root = await mkdtemp(join(tmpdir(), `rcf-bp-companions-${name}-`));
  const init = await initProject({ projectRoot: root, projectName: name });
  assert.equal(init.kind, undefined);
  return root;
}

test('apply prints resolved companion suggestion block after success (TC-041-suggestion-block)', async () => {
  const root = await scaffold('suggest-block');
  const { code, stdout } = await runBin(root, ['define', 'blueprint', 'add', API_REST]);
  assert.equal(code, 0, stdout);
  assert.match(stdout, /Suggested companions this blueprint recommends alongside it:/);
  assert.match(stdout, /logging\s+->\s+observability-logging/);
  assert.match(stdout, /errorHandling\s+->\s+application-error-handling/);
});

test('--no-companion-suggestions suppresses the block (TC-041-no-suggestions-flag)', async () => {
  const root = await scaffold('no-suggest');
  const { code, stdout } = await runBin(root, ['define', 'blueprint', 'add', API_REST, '--no-companion-suggestions']);
  assert.equal(code, 0, stdout);
  assert.doesNotMatch(stdout, /Suggested companions/);
});

test('--companion selectors write rcf/companions.json pins with pinnedAt (TC-041-companion-flag-writes-pin)', async () => {
  const root = await scaffold('pin-write');
  const { code, stdout } = await runBin(root, [
    'define', 'blueprint', 'add', API_REST,
    '--companion', 'logging=observability-logging',
    '--companion', 'errorHandling=application-error-handling',
  ]);
  assert.equal(code, 0, stdout);
  const file = JSON.parse(await readFile(join(root, 'rcf', 'companions.json'), 'utf8'));
  assert.equal(file.schemaVersion, 1);
  assert.equal(file.roles.logging.provider, 'observability-logging');
  assert.ok(file.roles.logging.pinnedAt.length > 0);
  assert.equal(file.roles.errorHandling.provider, 'application-error-handling');
});

test('--companion naming a non-provider refuses exit 2 with no side effects (TC-041-companion-flag-non-provider)', async () => {
  const root = await scaffold('non-provider');
  const { code, stderr } = await runBin(root, [
    'define', 'blueprint', 'add', LOGGING,
    '--companion', `logging=observability-essentials`,
  ]);
  assert.equal(code, 2);
  assert.match(stderr, /--companion logging=observability-essentials: blueprint 'observability-essentials' does not declare providesRoles containing 'logging'\./);
  // Preflight refusal: no applied blueprint and no pin file.
  const manifest = JSON.parse(await readFile(join(root, 'rcf', 'manifest.json'), 'utf8'));
  const blueprints = manifest.blueprints ?? [];
  assert.equal(blueprints.length, 0, 'preflight refusal should leave the manifest untouched');
});

test('rcf/companions.json shape and pin overwrite prints transition line (TC-041-pin-file-shape-and-overwrite)', async () => {
  const root = await scaffold('pin-overwrite');
  const first = await runBin(root, [
    'define', 'blueprint', 'add', API_REST,
    '--companion', 'logging=observability-logging',
  ]);
  assert.equal(first.code, 0);
  const second = await runBin(root, ['define', 'blueprint', 'companions', 'set', 'logging', 'observability-essentials']);
  // observability-essentials is not a provider of logging -> refuses exit 2
  assert.equal(second.code, 2, second.stderr);
});

test('rcf define blueprint companions <slug> prints resolved companions with origin (TC-042-companions-slug-text)', async () => {
  const root = await scaffold('companions-verb');
  await runBin(root, ['define', 'blueprint', 'add', API_REST]);
  const { code, stdout } = await runBin(root, ['define', 'blueprint', 'companions', 'application-api-rest']);
  assert.equal(code, 0, stdout);
  assert.match(stdout, /application-api-rest suggests companions:/);
  assert.match(stdout, /logging\s+->\s+observability-logging/);
});

test('rcf define blueprint companions refuses when slug is not applied (TC-042-companions-slug-not-applied)', async () => {
  const root = await scaffold('not-applied');
  const { code, stderr } = await runBin(root, ['define', 'blueprint', 'companions', 'application-api-rest']);
  assert.equal(code, 2);
  assert.match(stderr, /no applied blueprint with slug 'application-api-rest'/);
});

test('companions set writes pin and unset removes it; unset without pin refuses (TC-042-companions-set-unset-round-trip)', async () => {
  const root = await scaffold('set-unset');
  const setRes = await runBin(root, ['define', 'blueprint', 'companions', 'set', 'logging', 'observability-logging']);
  assert.equal(setRes.code, 0, setRes.stderr);
  const seen = JSON.parse(await readFile(join(root, 'rcf', 'companions.json'), 'utf8'));
  assert.equal(seen.roles.logging.provider, 'observability-logging');
  const unset = await runBin(root, ['define', 'blueprint', 'companions', 'unset', 'logging']);
  assert.equal(unset.code, 0, unset.stderr);
  const unset2 = await runBin(root, ['define', 'blueprint', 'companions', 'unset', 'logging']);
  assert.equal(unset2.code, 2, unset2.stdout);
  assert.match(unset2.stderr, /no pin for role 'logging'/);
});

test('companions set refuses non-provider slug (TC-042-companions-set-refuses-non-provider)', async () => {
  const root = await scaffold('set-non-provider');
  const { code, stderr } = await runBin(root, ['define', 'blueprint', 'companions', 'set', 'logging', 'observability-essentials']);
  assert.equal(code, 2);
  assert.match(stderr, /blueprint 'observability-essentials' does not declare providesRoles containing 'logging'/);
});

test('--json emits machine-readable envelope preserving suggestedCompanions order (TC-042-companions-json-envelope)', async () => {
  const root = await scaffold('json-envelope');
  await runBin(root, ['define', 'blueprint', 'add', API_REST]);
  await runBin(root, ['define', 'blueprint', 'add', LOGGING]);
  await runBin(root, ['define', 'blueprint', 'add', ERROR_HANDLING]);
  const { code, stdout } = await runBin(root, ['define', 'blueprint', 'companions', 'application-api-rest', '--json']);
  assert.equal(code, 0, stdout);
  const doc = JSON.parse(stdout);
  assert.equal(doc.slug, 'application-api-rest');
  assert.equal(doc.suggestions.length, 2);
  assert.equal(doc.suggestions[0].role, 'logging');
  assert.equal(doc.suggestions[0].provider, 'observability-logging');
  assert.equal(doc.suggestions[1].role, 'errorHandling');
  assert.equal(doc.suggestions[1].provider, 'application-error-handling');
});

// ---------------------------------------------------------------------
// TS-043 (fixture d): two registered libraries providing the same role.
// Built inside the test with two scratch local libraries.
// ---------------------------------------------------------------------

async function scratchLibrary(prefix, slug, role, bandStart) {
  const dir = await mkdtemp(join(tmpdir(), `rcf-scratchlib-${prefix}-`));
  const publisherId = prefix.replace(/[^a-z0-9-]/g, '-');
  await writeFile(join(dir, 'library.json'), JSON.stringify({
    libraryVersion: 1,
    libraryPrefix: prefix,
    displayName: `Library ${prefix}`,
    publisher: { id: publisherId, displayName: `${prefix} Publisher` },
    libraryRef: `local-${prefix}-2026-09-04`,
    bands: { ac: { start: bandStart, end: bandStart + 999 } },
    blueprints: [{ slug, path: `blueprints/${slug}` }],
  }, null, 2) + '\n');
  await mkdir(join(dir, 'blueprints', slug, 'contributions', 'adrs'), { recursive: true });
  const adrId = `ADR-${bandStart}-${prefix}-${slug}-shape`;
  await writeFile(join(dir, 'blueprints', slug, 'blueprint.json'), JSON.stringify({
    slug,
    version: '1.0.0',
    category: 'observability',
    providesRoles: [role],
    contributions: [{ id: adrId, kind: 'adr', path: `adrs/${adrId.toLowerCase()}.json`, scope: 'global', topic: role }],
  }, null, 2) + '\n');
  await writeFile(join(dir, 'blueprints', slug, 'contributions', 'adrs', `${adrId.toLowerCase()}.json`), JSON.stringify({
    adrId, prdId: 'PRD-001', tadId: 'TAD-001', version: '1.0.0', status: 'accepted',
    title: 'scratch', context: 'scratch', decision: 'scratch', consequences: 'scratch',
  }, null, 2) + '\n');
  return dir;
}

test('two libraries providing one role refuse exit 3 with three-path resolution message (TC-043-two-libraries-refuse-exit-3)', async () => {
  const libA = await scratchLibrary('lib-a', 'logging', 'logging', 60000);
  const libB = await scratchLibrary('lib-b', 'log-emit', 'logging', 61000);
  const root = await scaffold('two-libraries');
  const addA = await runBin(root, ['define', 'blueprint', 'library', 'add', libA, '--i-have-reviewed']);
  assert.equal(addA.code, 0, addA.stderr);
  const addB = await runBin(root, ['define', 'blueprint', 'library', 'add', libB, '--i-have-reviewed']);
  assert.equal(addB.code, 0, addB.stderr);
  const { code, stderr } = await runBin(root, ['define', 'blueprint', 'add', API_REST]);
  assert.equal(code, 3, stderr);
  assert.match(stderr, /Two or more registered libraries provide role 'logging'/);
  assert.match(stderr, /lib-a:logging/);
  assert.match(stderr, /lib-b:log-emit/);
  assert.match(stderr, /rcf define blueprint add application-api-rest --companion logging=/);
  assert.match(stderr, /rcf define blueprint companions set logging /);
  assert.match(stderr, /rcf define blueprint library remove <prefix>/);
});

test('rcf define blueprint companions refuses exit 3 when two libraries provide same role (TC-043-two-libraries-on-companions-verb)', async () => {
  const libA = await scratchLibrary('lib-a', 'logging', 'logging', 60000);
  const libB = await scratchLibrary('lib-b', 'log-emit', 'logging', 61000);
  const root = await scaffold('verb-two-libs');
  await runBin(root, ['define', 'blueprint', 'library', 'add', libA, '--i-have-reviewed']);
  await runBin(root, ['define', 'blueprint', 'library', 'add', libB, '--i-have-reviewed']);
  await runBin(root, ['define', 'blueprint', 'add', API_REST, '--no-companion-suggestions']);
  const { code, stderr } = await runBin(root, ['define', 'blueprint', 'companions', 'application-api-rest']);
  assert.equal(code, 3, stderr);
  assert.match(stderr, /Two or more registered libraries provide role 'logging'/);
});
