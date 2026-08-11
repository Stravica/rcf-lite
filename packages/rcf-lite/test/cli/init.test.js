// `rcf init` subcommand tests. Interactive-mode prompt tests drive the
// exported main() with piped stdin; non-interactive tests spawn the bin
// as a subprocess.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
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
  assert.match(stdout, /RCF project created/);
  const manifest = JSON.parse(await readFile(join(tmp, 'rcf', 'manifest.json'), 'utf8'));
  assert.equal(manifest.projectName, 'TestProj');
});

test('rcf init without --project-name and no TTY fails with exit 2', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-init-noname-'));
  const { code, stderr } = await runBinInit(tmp, ['--non-interactive']);
  assert.equal(code, 2);
  assert.match(stderr, /--project-name is required/);
});

test('rcf init never overwrites an existing tree; re-run refreshes the wiring (Theme 1)', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-init-twice-'));
  await runBinInit(tmp, ['--project-name', 'A', '--non-interactive']);
  const { code, stdout } = await runBinInit(tmp, ['--project-name', 'B', '--non-interactive']);
  assert.equal(code, 0);
  assert.match(stdout, /already set up here - document chain left untouched/);
  const manifest = JSON.parse(await readFile(join(tmp, 'rcf', 'manifest.json'), 'utf8'));
  assert.equal(manifest.projectName, 'A', 'tree files are never overwritten');
});

test('rcf init --no-agent-setup on an existing project still refuses (exit 2, nothing to do)', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-init-twice-optout-'));
  await runBinInit(tmp, ['--project-name', 'A', '--non-interactive']);
  const { code, stderr } = await runBinInit(tmp, ['--project-name', 'B', '--non-interactive', '--no-agent-setup']);
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

test('rcf init interactive prompts ONLY for the project name and seeds placeholders (comment 2)', async () => {
  // Init is a bootstrap, not elicitation: it must not ask the user to
  // name a first requirement / story / problem statement up front. Drive
  // main() with a fake TTY stdin/stdout and assert the single prompt.
  const { main } = await import('../../src/cli/init.js');
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-init-interactive-'));

  const stdin = new PassThrough();
  stdin.isTTY = true;
  const stdout = new PassThrough();
  stdout.isTTY = true;
  let out = '';
  stdout.on('data', (c) => { out += c.toString(); });
  const stderr = new PassThrough();
  let err = '';
  stderr.on('data', (c) => { err += c.toString(); });

  // The only line the user has to type is the project name.
  stdin.write('My Interactive Proj\n');

  const code = await main([], { stdin, stdout, stderr, cwd: tmp });
  assert.equal(code, 0, err);

  // Exactly one prompt, and it is the project name - the dropped prompts
  // (requirement title, user story title, problem statement) are gone.
  assert.match(out, /Project name:/);
  assert.doesNotMatch(out, /requirement title/i);
  assert.doesNotMatch(out, /user story title/i);
  assert.doesNotMatch(out, /problem statement/i);

  // The tree is seeded with placeholders - no product specifics extracted
  // at init time, identical shape to the non-interactive seed path.
  const manifest = JSON.parse(await readFile(join(tmp, 'rcf', 'manifest.json'), 'utf8'));
  assert.equal(manifest.projectName, 'My Interactive Proj');
  const req = JSON.parse(await readFile(join(tmp, 'rcf', 'requirements', 'req-001.json'), 'utf8'));
  assert.match(req.title, /^TODO:/);
  const us = JSON.parse(await readFile(join(tmp, 'rcf', 'user-stories', 'us-101.json'), 'utf8'));
  assert.match(us.title, /^TODO:/);
  const prd = JSON.parse(await readFile(join(tmp, 'rcf', 'prd.json'), 'utf8'));
  assert.match(prd.problemStatement, /^TODO:/);
});

test('rcf init interactive seed produces the expected doc bodies (D5 + D22)', async () => {
  // Interactive-mode seed values feed initProject directly; the four
  // prompts are exercised by the readline integration in the CLI. This
  // test exercises the store-level seed contract (interactive flag
  // flips ADR-001 to `draft`; seed values flow into PRD, REQ, US).
  const { initProject } = await import('@stravica-ai/rcf-lite-core/store/init.js');
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
  const { initProject } = await import('@stravica-ai/rcf-lite-core/store/init.js');
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-init-noninteractive-adr-'));
  await initProject({ projectRoot: tmp, projectName: 'Scripted' });
  const adr = JSON.parse(await readFile(join(tmp, 'rcf', 'adrs', 'adr-001.json'), 'utf8'));
  assert.equal(adr.status, 'proposed');
});
