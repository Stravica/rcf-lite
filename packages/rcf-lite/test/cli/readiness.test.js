// CLI tests for `rcf define readiness` (REQ-175; proposal §2.4,
// §6.2 v3).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { initProject } from '#core/store/init.js';

import { main } from '../../src/cli/readiness.js';

/** Buffered writable that exposes accumulated text. */
function makeSink() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, _enc, cb) { chunks.push(chunk); cb(); },
  });
  Object.defineProperty(stream, 'text', { get() { return Buffer.concat(chunks).toString('utf8'); } });
  return stream;
}

async function scratchProject(prefix = 'readiness-cli-') {
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

test('readiness cli: --help prints the usage block', async () => {
  const cwd = await scratchProject();
  const r = await run(['--help'], cwd);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Usage: rcf define readiness/);
  assert.match(r.stdout, /--check <stage>/);
});

test('readiness cli: unknown --check name exits 2 with usage error', async () => {
  const cwd = await scratchProject();
  const r = await run(['--check', 'nonsense'], cwd);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /unknown --check/);
});

test('readiness cli: text output shape and --check exit codes', async () => {
  const cwd = await scratchProject();
  // On a freshly-initialised project the tree is minimal: the D1
  // brief check fails (no brief statements yet, no profile markers)
  // and D8 fails (no queue head). This is expected on a fresh init.
  const rDefault = await run([], cwd);
  assert.equal(rDefault.code, 0);
  assert.match(rDefault.stdout, /Unfrozen\./);
  assert.match(rDefault.stdout, /Next action:/);
  assert.match(rDefault.stdout, /Chips: D1:/);
  assert.match(rDefault.stdout, /Freezeable: (yes|no)\./);

  // --check freeze -> blocking stage failing -> exit 4.
  const rFreeze = await run(['--check', 'freeze'], cwd);
  assert.equal(rFreeze.code, 4);
  assert.match(rFreeze.stdout, /D8 \(define.freeze\)/);

  // --check shapes on a fresh init: TAC-001 exists with no
  // interfaces, so D3 (warn-with-ack in 0.29.0) is failing without an
  // acknowledgement. Warn-with-ack policy means exit 0 (never 4) with
  // a visible [warn] line on stderr naming the gate.
  const rShapes = await run(['--check', 'shapes'], cwd);
  assert.equal(rShapes.code, 0);
  assert.match(rShapes.stderr, /\[warn\] readiness: D3 \(define\.shapes\) is failing without an acknowledgement/);
});

test('readiness cli: --json emits the full readiness object', async () => {
  const cwd = await scratchProject();
  const r = await run(['--json'], cwd);
  assert.equal(r.code, 0);
  const parsed = JSON.parse(r.stdout);
  assert.ok(parsed.tree);
  assert.ok(parsed.delta);
  assert.ok(Array.isArray(parsed.stages));
  assert.equal(parsed.stages.length, 8);
  assert.ok(parsed.coverage && parsed.coverage.tree);
  assert.equal(typeof parsed.freezeable, 'boolean');
  // _meta side-band is stable-by-convention.
  assert.ok(parsed._meta && typeof parsed._meta.wallMs === 'number');
});

test('readiness cli: no project root exits 2 with usage error', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'readiness-noroot-'));
  const r = await run([], cwd);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /no project root found/);
});
