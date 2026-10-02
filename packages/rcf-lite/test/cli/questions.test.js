// CLI tests for `rcf define questions` (REQ-186; spec 2026-10-01 §6).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { Writable } from 'node:stream';

import { initProject } from '#core/store/init.js';
import { main } from '../../src/cli/questions.js';

function makeSink() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, _enc, cb) { chunks.push(chunk); cb(); },
  });
  Object.defineProperty(stream, 'text', { get() { return Buffer.concat(chunks).toString('utf8'); } });
  return stream;
}

async function scratchProject(prefix = 'questions-cli-') {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const result = await initProject({ projectRoot: root });
  assert.ok(result && Array.isArray(result.created), `initProject failed: ${JSON.stringify(result)}`);
  return root;
}

async function run(argv, cwd) {
  const stdout = makeSink();
  const stderr = makeSink();
  const code = await main(argv, { stdout, stderr, cwd });
  return { code, stdout: stdout.text, stderr: stderr.text };
}

/** Mtime snapshot of rcf/ for the no-write mtime guard. */
function snapshotRcfDir(cwd) {
  const rcf = join(cwd, 'rcf');
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      const s = statSync(abs);
      if (s.isDirectory()) walk(abs);
      else out.push({ rel: relative(cwd, abs), mtimeMs: s.mtimeMs, size: s.size });
    }
  };
  walk(rcf);
  out.sort((a, b) => a.rel.localeCompare(b.rel));
  return out;
}

// --- AC-18602-1 --json shape and exit 0 ---

test('AC-18602-1: --json on a failing tree prints the questions object and exits 0', async () => {
  const cwd = await scratchProject();
  const r = await run(['--json'], cwd);
  assert.equal(r.code, 0, r.stderr);
  const obj = JSON.parse(r.stdout);
  assert.equal(typeof obj.treeHash, 'string');
  assert.equal(obj.persona, 'productOwner');
  assert.equal(obj.level, 'intent');
  assert.equal(typeof obj.remaining, 'number');
  assert.ok(Array.isArray(obj.questions));
  assert.ok(Array.isArray(obj.groups));
});

// --- AC-18602-2 persona default from profile register ---

test('AC-18602-2: persona defaults from profile register', async () => {
  const cwd = await scratchProject();
  // No profile yet (fresh init) -> default productOwner.
  const r1 = await run(['--json'], cwd);
  const obj1 = JSON.parse(r1.stdout);
  assert.equal(obj1.persona, 'productOwner');
  // Write an engineer-register profile and re-run.
  await mkdir(join(cwd, 'rcf', '.identity'), { recursive: true });
  await writeFile(
    join(cwd, 'rcf', '.identity', 'profile.md'),
    '# Profile\n\nRegister: engineer\n',
    'utf8',
  );
  const r2 = await run(['--json'], cwd);
  const obj2 = JSON.parse(r2.stdout);
  assert.equal(obj2.persona, 'engineer');
});

// --- AC-18602-3 --stage and --limit ---

test('AC-18602-3: --stage brief --limit 1 caps the output but keeps remaining honest', async () => {
  const cwd = await scratchProject();
  const r = await run(['--json', '--stage', 'brief', '--limit', '1'], cwd);
  assert.equal(r.code, 0, r.stderr);
  const obj = JSON.parse(r.stdout);
  assert.ok(obj.questions.length <= 1);
  for (const q of obj.questions) assert.equal(q.stage, 'D1');
  // remaining counts every D1 question BEFORE the cap.
  assert.ok(obj.remaining >= obj.questions.length);
});

// --- AC-18602-5 unknown persona exits 2 with usage ---

test('AC-18602-5: --persona architect exits 2 naming productOwner and engineer', async () => {
  const cwd = await scratchProject();
  const r = await run(['--persona', 'architect'], cwd);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /productOwner/);
  assert.match(r.stderr, /engineer/);
});

// --- AC-18602-6 writes nothing under rcf/ (mtime guard) ---

test('AC-18602-6: questions writes nothing under rcf/', async () => {
  const cwd = await scratchProject();
  const before = snapshotRcfDir(cwd);
  await run(['--json'], cwd);
  const after1 = snapshotRcfDir(cwd);
  assert.deepEqual(after1, before);
  await run([], cwd);
  const after2 = snapshotRcfDir(cwd);
  assert.deepEqual(after2, before);
});

// --- --help prints the usage block ---

test('questions cli: --help prints the usage block', async () => {
  const cwd = await scratchProject();
  const r = await run(['--help'], cwd);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Usage: rcf define questions/);
  assert.match(r.stdout, /--persona <who>/);
});
