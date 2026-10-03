// MCP tests for rcf_define_questions (AC-18602-4).
// The structuredContent of the MCP tool deep-equals the CLI verb's
// --json output on the same tree.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { initProject } from '#core/store/init.js';
import { createToolRegistry } from '../../src/mcp/tools.js';
import { main as questionsMain } from '../../src/cli/questions.js';

const silentLog = { info: () => {}, error: () => {} };

function makeSink() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, _enc, cb) { chunks.push(chunk); cb(); },
  });
  Object.defineProperty(stream, 'text', { get() { return Buffer.concat(chunks).toString('utf8'); } });
  return stream;
}

async function scratchProject(prefix = 'questions-mcp-') {
  const root = await mkdtemp(join(tmpdir(), prefix));
  await initProject({ projectRoot: root });
  return root;
}

test('AC-18602-4: rcf_define_questions structuredContent deep-equals the verb --json', async () => {
  const cwd = await scratchProject();

  // CLI run.
  const stdout = makeSink();
  const stderr = makeSink();
  const code = await questionsMain(['--json'], { stdout, stderr, cwd });
  assert.equal(code, 0, stderr.text);
  const cliEnvelope = JSON.parse(stdout.text);

  // MCP tool run; the handler walks the tree in the same way.
  const registry = createToolRegistry({ projectRoot: cwd, log: silentLog });
  const result = await registry.call('rcf_define_questions', {});
  const mcpEnvelope = result.structuredContent;

  // Deep-equal.
  assert.deepEqual(mcpEnvelope, cliEnvelope);
});

test('rcf_define_questions accepts persona, stage, limit as inputs', async () => {
  const cwd = await scratchProject();
  const registry = createToolRegistry({ projectRoot: cwd, log: silentLog });
  const r = await registry.call('rcf_define_questions', { persona: 'engineer', stage: 'brief', limit: 1 });
  const env = r.structuredContent;
  assert.equal(env.persona, 'engineer');
  assert.ok(env.questions.length <= 1);
});

test('rcf_define_questions refuses an unknown persona value with usage', async () => {
  const cwd = await scratchProject();
  const registry = createToolRegistry({ projectRoot: cwd, log: silentLog });
  const r = await registry.call('rcf_define_questions', { persona: 'bogus' });
  // The validator rejects it as an invalid-arg problem; the handler
  // never runs. Either `isError: true` with structured error, or the
  // schema layer returning a usage result.
  assert.ok(r.isError === true || (r.structuredContent && r.structuredContent.ok === false));
});

test('rcf_define_readiness returns the readiness envelope on a fresh project', async () => {
  const cwd = await scratchProject();
  const registry = createToolRegistry({ projectRoot: cwd, log: silentLog });
  const r = await registry.call('rcf_define_readiness', {});
  const env = r.structuredContent;
  assert.ok(env && typeof env === 'object');
  assert.ok(env.levels && typeof env.levels.intentComplete === 'object');
  assert.ok(env.stages && Array.isArray(env.stages));
});

test('rcf_define_ledger wraps the ledger CLI (brief list on empty tree)', async () => {
  const cwd = await scratchProject();
  const registry = createToolRegistry({ projectRoot: cwd, log: silentLog });
  const r = await registry.call('rcf_define_ledger', { name: 'brief', verb: 'list' });
  const env = r.structuredContent;
  assert.ok(env && typeof env === 'object');
  // The ledger list envelope echoes the ledger name under `ledger`.
  assert.ok(env.ledger === 'brief' || env.statements !== undefined || env.ok === true);
});
