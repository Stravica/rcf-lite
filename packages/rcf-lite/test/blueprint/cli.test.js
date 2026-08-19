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
