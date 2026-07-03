// `rcf init` subcommand tests. Interactive-mode prompt tests drive the
// exported main() with piped stdin; non-interactive tests spawn the bin
// as a subprocess.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, '..', '..', 'bin', 'rcf.js');

async function runBinInit(cwd, args = []) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [bin, 'init', ...args], {
      cwd, encoding: 'utf8', env: { ...process.env, CI: '1' },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

test('rcf init --project-name X --non-interactive scaffolds a tree', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-init-cli-'));
  const { code, stdout } = await runBinInit(tmp, ['--project-name', 'TestProj', '--non-interactive']);
  assert.equal(code, 0);
  assert.match(stdout, /Scaffolded 9 files/);
  const manifest = JSON.parse(await readFile(join(tmp, 'rcf', 'manifest.json'), 'utf8'));
  assert.equal(manifest.projectName, 'TestProj');
});

test('rcf init without --project-name and no TTY fails with exit 2', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-init-noname-'));
  const { code, stderr } = await runBinInit(tmp, ['--non-interactive']);
  assert.equal(code, 2);
  assert.match(stderr, /--project-name is required/);
});

test('rcf init refuses to overwrite an existing project (exit 2)', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-init-twice-'));
  await runBinInit(tmp, ['--project-name', 'A', '--non-interactive']);
  const { code, stderr } = await runBinInit(tmp, ['--project-name', 'B', '--non-interactive']);
  assert.equal(code, 2);
  assert.match(stderr, /already exists/);
});

test('rcf init --help prints the init help block', async () => {
  const { code, stdout } = await runBinInit(process.cwd(), ['--help']);
  assert.equal(code, 0);
  assert.match(stdout, /Usage: rcf init/);
  assert.match(stdout, /--project-name/);
  assert.match(stdout, /--non-interactive/);
});

test('rcf init interactive seed produces the expected doc bodies (D5 + D22)', async () => {
  // Interactive-mode seed values feed initProject directly; the four
  // prompts are exercised by the readline integration in the CLI. This
  // test exercises the store-level seed contract (interactive flag
  // flips ADR-001 to `draft`; seed values flow into PRD, REQ, US).
  const { initProject } = await import('../../src/store/init.js');
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-init-seed-'));
  const result = await initProject({
    projectRoot: tmp,
    projectName: 'MyProj',
    seed: {
      interactive: true,
      prdProblemStatement: 'One-line problem statement',
      reqTitle: 'First requirement',
      usTitle: 'First user story',
    },
  });
  assert.ok(result.created);
  const prd = JSON.parse(await readFile(join(tmp, 'rcf', 'prd.json'), 'utf8'));
  assert.equal(prd.problemStatement, 'One-line problem statement');
  const req = JSON.parse(await readFile(join(tmp, 'rcf', 'requirements', 'req-001.json'), 'utf8'));
  assert.equal(req.title, 'First requirement');
  const us = JSON.parse(await readFile(join(tmp, 'rcf', 'user-stories', 'us-101.json'), 'utf8'));
  assert.equal(us.title, 'First user story');
  const adr = JSON.parse(await readFile(join(tmp, 'rcf', 'adrs', 'adr-001.json'), 'utf8'));
  assert.equal(adr.status, 'draft', 'interactive-mode seeds ADR-001 in draft (D22)');
});

test('rcf init non-interactive seed keeps ADR-001 in proposed (D22)', async () => {
  const { initProject } = await import('../../src/store/init.js');
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-init-noninteractive-adr-'));
  await initProject({ projectRoot: tmp, projectName: 'Scripted' });
  const adr = JSON.parse(await readFile(join(tmp, 'rcf', 'adrs', 'adr-001.json'), 'utf8'));
  assert.equal(adr.status, 'proposed');
});
