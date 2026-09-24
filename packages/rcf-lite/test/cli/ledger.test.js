// CLI tests for `rcf define ledger` (REQ-173; proposal §8.2 v3).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { main } from '../../src/cli/ledger.js';
import { loadLedger, ledgerRelPath } from '../../src/define/ledgers.js';

function makeSink() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, _enc, cb) { chunks.push(chunk); cb(); },
  });
  Object.defineProperty(stream, 'text', { get() { return Buffer.concat(chunks).toString('utf8'); } });
  return stream;
}

async function scratchProject(prefix = 'ledger-cli-') {
  const cwd = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(cwd, 'rcf'), { recursive: true });
  // Minimal manifest so findProjectRoot succeeds; the walker is never
  // called by the ledger CLI so the manifest need not be schema-valid.
  await writeFile(join(cwd, 'rcf', 'manifest.json'), JSON.stringify({ prdId: 'PRD-001' }), 'utf8');
  return cwd;
}

async function run(argv, cwd) {
  const stdout = makeSink();
  const stderr = makeSink();
  const code = await main(argv, { stdout, stderr, cwd });
  return { code, stdout: stdout.text, stderr: stderr.text };
}

test('ledger CLI: brief add --text appends a numbered statement', async () => {
  const cwd = await scratchProject();
  const r1 = await run([
    'brief', 'add', '--kind', 'capability', '--text', 'ship freeze detection',
  ], cwd);
  assert.equal(r1.code, 0, r1.stderr);
  assert.match(r1.stdout, /ids 1/);
  const body = await loadLedger({ projectRoot: cwd, name: 'brief' });
  assert.equal(body.statements.length, 1);
  assert.equal(body.statements[0].kind, 'capability');
  assert.equal(body.statements[0].id, 1);
});

test('ledger CLI: brief add --from <file> splits by non-empty line', async () => {
  const cwd = await scratchProject();
  const brief = join(cwd, 'briefs.md');
  await writeFile(brief, '- Statement one\n- Statement two\n\n- Statement three\n', 'utf8');
  const r = await run(['brief', 'add', '--from', brief, '--kind', 'capability'], cwd);
  assert.equal(r.code, 0, r.stderr);
  const body = await loadLedger({ projectRoot: cwd, name: 'brief' });
  assert.equal(body.statements.length, 3);
  assert.deepEqual(body.statements.map((s) => s.text), [
    'Statement one', 'Statement two', 'Statement three',
  ]);
  assert.deepEqual(body.statements.map((s) => s.id), [1, 2, 3]);
});

test('ledger CLI: decisions list prints the numbered #241 format', async () => {
  const cwd = await scratchProject();
  await run([
    'decisions', 'add',
    '--question', 'What is the AC class marker?',
    '--option', 'a:bracketed prefix on description',
    '--option', 'b:schema field',
    '--default', 'a',
    '--blocks', 'D4',
  ], cwd);
  const list = await run(['decisions', 'list'], cwd);
  assert.equal(list.code, 0, list.stderr);
  assert.match(list.stdout, /^1\. What is the AC class marker\?/m);
  assert.match(list.stdout, /^\s*a\) bracketed prefix on description$/m);
  assert.match(list.stdout, /^\s*b\) schema field$/m);
  assert.match(list.stdout, /default: a/);
  assert.match(list.stdout, /blocks: D4/);
});

test('ledger CLI: unknown ledger name exits 2 with a usage error', async () => {
  const cwd = await scratchProject();
  const r = await run(['not-a-ledger', 'list'], cwd);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /unknown name 'not-a-ledger'/);
});

test('ledger CLI: brief add refuses conflicting --text and --from with a usage error', async () => {
  const cwd = await scratchProject();
  const briefFile = join(cwd, 'x.md');
  await writeFile(briefFile, 'line', 'utf8');
  const r = await run(['brief', 'add', '--text', 't', '--from', briefFile], cwd);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--text OR --from/);
});

test('ledger CLI: resolve <id> flips status to resolved and stamps resolvedAt', async () => {
  const cwd = await scratchProject();
  await run(['probes', 'add', '--req', 'REQ-172', '--finding', 'x', '--severity', 'low'], cwd);
  const r = await run(['probes', 'resolve', '1', '--reason', 'fixed'], cwd);
  assert.equal(r.code, 0, r.stderr);
  const body = await loadLedger({ projectRoot: cwd, name: 'probes' });
  assert.equal(body.probes[0].status, 'resolved');
  assert.ok(body.probes[0].resolvedAt);
  assert.equal(body.probes[0].reason, 'fixed');
});

test('ledger CLI: list --json emits the machine-readable envelope', async () => {
  const cwd = await scratchProject();
  await run(['brief', 'add', '--text', 'x', '--kind', 'capability'], cwd);
  const r = await run(['brief', 'list', '--json'], cwd);
  assert.equal(r.code, 0, r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.ledger, 'brief');
  assert.equal(parsed.statements.length, 1);
});

test('ledger CLI: writes land at the proposal-mandated relative path', async () => {
  const cwd = await scratchProject();
  await run(['brief', 'add', '--text', 'x'], cwd);
  const raw = await readFile(join(cwd, ledgerRelPath('brief')), 'utf8');
  const parsed = JSON.parse(raw);
  assert.equal(parsed.statements[0].text, 'x');
});
