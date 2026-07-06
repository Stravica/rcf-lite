// Envelope parity goldens (Phase 7 §D20): for each query verb, the
// tools/call structuredContent must deep-equal the committed Phase 5
// golden fixture against the dogfood tree - the D15-contract
// regression net. Plus live-CLI parity for validate (--json) and
// build (--format json): same tree, same arguments, byte-identical as
// parsed JSON (done-when 4).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { createToolRegistry } from '../../src/mcp/tools.js';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const bin = resolve(repoRoot, 'bin', 'rcf.js');
const fixturesDir = resolve(repoRoot, 'test', 'query', 'fixtures');

const registry = createToolRegistry({ projectRoot: repoRoot, log: { info: () => {}, error: () => {} } });

async function golden(fixture) {
  return JSON.parse(await readFile(resolve(fixturesDir, fixture), 'utf8'));
}

async function runBin(args) {
  const { stdout } = await exec(process.execPath, [bin, ...args], {
    cwd: repoRoot, encoding: 'utf8', env: { ...process.env, CI: '1' },
  });
  return stdout;
}

test('parity: rcf_coverage structuredContent deep-equals the committed coverage golden', async () => {
  const result = await registry.call('rcf_coverage', {});
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.structuredContent, await golden('coverage.json'));
});

test('parity: rcf_trace REQ-002 forward structuredContent deep-equals the committed trace golden', async () => {
  const result = await registry.call('rcf_trace', { id: 'REQ-002', direction: 'forward' });
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.structuredContent, await golden('trace.json'));
});

test('parity: rcf_impact TAC-001 structuredContent deep-equals the committed impact golden', async () => {
  const result = await registry.call('rcf_impact', { id: 'TAC-001' });
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.structuredContent, await golden('impact.json'));
});

test('parity: rcf_validate structuredContent deep-equals live `rcf validate --json`', async () => {
  const cli = JSON.parse(await runBin(['validate', '--json']));
  const result = await registry.call('rcf_validate', {});
  assert.deepEqual(result.structuredContent, cli);
});

test('parity: rcf_build FBS-001 structuredContent deep-equals live `rcf build FBS-001 --format json`', async () => {
  const cli = JSON.parse(await runBin(['build', 'FBS-001', '--format', 'json']));
  const result = await registry.call('rcf_build', { fbsId: 'FBS-001' });
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.structuredContent, cli);
});

test('parity: the text content block re-parses to the same envelope as structuredContent (every query verb)', async () => {
  for (const [name, args] of [
    ['rcf_coverage', {}],
    ['rcf_trace', { id: 'REQ-002' }],
    ['rcf_impact', { id: 'TAC-001' }],
    ['rcf_validate', {}],
  ]) {
    const result = await registry.call(name, args);
    assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent, name);
  }
});
