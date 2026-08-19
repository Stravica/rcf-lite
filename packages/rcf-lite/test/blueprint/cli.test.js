// CLI-level tests for `rcf blueprint` and `rcf standards`. Covers
// AC-1001-5 (top-level help advertises blueprint), CLI wiring, and
// exit codes on refused conflicts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { initProject } from '#core/store';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, '..', '..', 'bin', 'rcf.js');

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

async function scaffold() {
  const root = await mkdtemp(join(tmpdir(), 'rcf-bp-cli-'));
  const init = await initProject({ projectRoot: root, projectName: 'CliBP' });
  assert.equal(init.kind, undefined);
  return root;
}

test('rcf --help advertises `blueprint` and `standards` as top-level commands (AC-1001-5)', async () => {
  const root = await scaffold();
  const { code, stdout } = await runBin(root, ['--help']);
  assert.equal(code, 0);
  assert.match(stdout, /blueprint <verb>/);
  assert.match(stdout, /standards <verb>/);
});

test('rcf help blueprint prints the blueprint HELP block', async () => {
  const root = await scaffold();
  const { code, stdout } = await runBin(root, ['help', 'blueprint']);
  assert.equal(code, 0);
  assert.match(stdout, /Usage: rcf blueprint <verb>/);
  assert.match(stdout, /add <source>/);
  assert.match(stdout, /remove <slug>/);
});

test('rcf blueprint list on a fresh project prints the no-blueprints notice and exits 0', async () => {
  const root = await scaffold();
  const { code, stdout } = await runBin(root, ['blueprint', 'list']);
  assert.equal(code, 0);
  assert.match(stdout, /no blueprints applied/);
});

test('rcf standards list on a fresh project prints the no-standards notice and exits 0', async () => {
  const root = await scaffold();
  const { code, stdout } = await runBin(root, ['standards', 'list']);
  assert.equal(code, 0);
  assert.match(stdout, /no standards packs registered/);
});

test('rcf blueprint add + list end-to-end via the CLI', async () => {
  const root = await scaffold();
  const bpDir = join(root, 'blueprint-alpha');
  await mkdir(join(bpDir, 'contributions'), { recursive: true });
  await writeFile(join(bpDir, 'blueprint.json'), JSON.stringify({
    slug: 'alpha', version: '1.0.0',
    contributions: [{ kind: 'req', id: 'alpha-REQ-001', path: 'alpha-req-001.json' }],
  }, null, 2), 'utf8');
  await writeFile(join(bpDir, 'contributions', 'alpha-req-001.json'), JSON.stringify({
    reqId: 'alpha-REQ-001', prdId: 'PRD-001',
    title: 'x', description: 'y', category: 'functional', priority: 'must', domain: 'ui',
    version: '0.1.0', status: 'draft',
    createdAt: '2026-08-19T00:00:00Z', updatedAt: '2026-08-19T00:00:00Z',
  }, null, 2), 'utf8');
  const addResult = await runBin(root, ['blueprint', 'add', bpDir]);
  assert.equal(addResult.code, 0, `add stderr: ${addResult.stderr}`);
  assert.match(addResult.stdout, /applied 'alpha' at 1\.0\.0/);
  const listResult = await runBin(root, ['blueprint', 'list']);
  assert.equal(listResult.code, 0);
  assert.match(listResult.stdout, /^alpha\t1\.0\.0/m);
});

// ---------------------------------------------------------------------------
// w-2026-08-19-001: prefix-family id derivation (rcf-schemas 0.4.4 grammar).
//
// Blueprint apply stamps a prefix-family id like `spa-REQ-001` and writes
// the contribution to `rcf/requirements/spa-req-001.json`. Pre-fix the
// walker's `idFromFilenameStem` split on the first hyphen and upper-cased
// the leading segment only -- `spa-req-001` derived as `SPA-req-001`,
// which then failed to resolve through `pathForId` (no `SPA-` /
// `spa-REQ-` case in the startsWith ladder), so a subsequent walk
// surfaced `Unrecognised document id: SPA-req-001` and `rcf validate`
// exited non-zero on a freshly-added prefix-family contribution.
//
// The fix routes both `idFromFilenameStem` (walker) and `pathForId`
// (loader) through the shared `parseIdParts` seat, which already knows
// the two 0.4.4 families (prefix REQ/US/PRD/BS/TAD/TS; suffix
// ADR/TAC/FBS/CN). Regression is a CLI-level round-trip: apply → walk
// clean → re-add idempotent → remove clean.
// ---------------------------------------------------------------------------
test('rcf blueprint add + validate round-trip for a prefix-family (slug-prefixed) contribution (w-2026-08-19-001)', async () => {
  const root = await scaffold();
  const bpDir = join(root, 'blueprint-spa');
  await mkdir(join(bpDir, 'contributions'), { recursive: true });
  await writeFile(join(bpDir, 'blueprint.json'), JSON.stringify({
    slug: 'spa', version: '0.1.0',
    contributions: [
      // Prefix-family: slug attaches as a lowercase prefix, e.g. spa-REQ-001.
      { kind: 'req', id: 'spa-REQ-001', path: 'spa-req-001.json' },
      { kind: 'us',  id: 'spa-US-101', path: 'spa-us-101.json' },
    ],
  }, null, 2), 'utf8');
  await writeFile(join(bpDir, 'contributions', 'spa-req-001.json'), JSON.stringify({
    reqId: 'spa-REQ-001', prdId: 'PRD-001',
    title: 'SPA prefix-family REQ',
    description: 'Round-trips a prefix-namespaced req through walker + loader.',
    category: 'functional', priority: 'must', domain: 'ui',
    version: '0.1.0', status: 'draft',
    createdAt: '2026-08-19T00:00:00Z', updatedAt: '2026-08-19T00:00:00Z',
  }, null, 2), 'utf8');
  await writeFile(join(bpDir, 'contributions', 'spa-us-101.json'), JSON.stringify({
    usId: 'spa-US-101', prdId: 'PRD-001', reqId: 'spa-REQ-001',
    version: '0.1.0', status: 'draft',
    title: 'SPA prefix-family US',
    description: 'Prefix-family user story bound to a prefix-family REQ.',
    asA: 'developer',
    iWant: 'prefix-family ids to round-trip cleanly through walker and loader',
    soThat: 'blueprint add of a prefix-family contribution is not broken',
    acceptanceCriteria: [{
      id: 'AC-999-1',
      description: 'The walker keys the added doc under spa-US-101',
      given: 'a prefix-family US on disk under spa-us-101.json',
      when: 'the walker derives an id from the filename stem',
      then: 'it derives spa-US-101 and pathForId resolves the id back to the file',
      testable: true,
    }],
    tacIds: [],
    createdAt: '2026-08-19T00:00:00Z', updatedAt: '2026-08-19T00:00:00Z',
  }, null, 2), 'utf8');

  // First apply -- must succeed.
  const first = await runBin(root, ['blueprint', 'add', bpDir]);
  assert.equal(first.code, 0, `first add stderr: ${first.stderr}\nstdout: ${first.stdout}`);
  assert.match(first.stdout, /applied 'spa' at 0\.1\.0/);

  // Pre-fix, `rcf validate` surfaced two `Unrecognised document id`
  // errors here (SPA-req-001, SPA-us-101) and exited non-zero. The fix
  // is proven by a clean exit + zero error output on the fresh tree.
  const validateAfterAdd = await runBin(root, ['validate']);
  assert.equal(validateAfterAdd.code, 0,
    `validate after add should exit 0.\nstdout: ${validateAfterAdd.stdout}\nstderr: ${validateAfterAdd.stderr}`);
  assert.doesNotMatch(validateAfterAdd.stderr, /Unrecognised document id/,
    `validate leaked an Unrecognised-id error: ${validateAfterAdd.stderr}`);

  // Idempotent re-apply of the same version is a no-op that MUST NOT
  // return a conflict or an error.
  const second = await runBin(root, ['blueprint', 'add', bpDir]);
  assert.equal(second.code, 0, `re-add stderr: ${second.stderr}\nstdout: ${second.stdout}`);

  // Validate must stay clean after the idempotent re-apply.
  const validateAfterReadd = await runBin(root, ['validate']);
  assert.equal(validateAfterReadd.code, 0,
    `validate after re-add should exit 0.\nstdout: ${validateAfterReadd.stdout}\nstderr: ${validateAfterReadd.stderr}`);

  // Remove leaves a clean tree.
  const remove = await runBin(root, ['blueprint', 'remove', 'spa']);
  assert.equal(remove.code, 0, `remove stderr: ${remove.stderr}\nstdout: ${remove.stdout}`);
  const validateAfterRemove = await runBin(root, ['validate']);
  assert.equal(validateAfterRemove.code, 0,
    `validate after remove should exit 0.\nstdout: ${validateAfterRemove.stdout}\nstderr: ${validateAfterRemove.stderr}`);
});
