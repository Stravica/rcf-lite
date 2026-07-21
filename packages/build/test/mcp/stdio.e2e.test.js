// Subprocess protocol e2e (Phase 7 §D20): spawn `node bin/rcf.js mcp`
// in a scaffolded temp project (the temp-dir pattern from
// test/cli/validate.test.js, adapted to a long-lived spawn with a
// line-buffered stdout reader) and drive the real handshake and tools
// over real pipes. Covers stdout purity, the no-root failure mode and
// the EOF / SIGTERM shutdown paths.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { initProject } from '@stravica-ai/rcf-lite-core/store/init.js';

const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, '..', '..', 'bin', 'rcf.js');

async function scaffold() {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-mcp-e2e-'));
  await initProject({ projectRoot: tmp, projectName: 'McpE2eTest' });
  return tmp;
}

/**
 * Spawn `rcf mcp` and return a tiny line-buffered client. Collects
 * every raw stdout line for the purity assertion.
 */
function spawnServer(cwd, args = []) {
  const child = spawn(process.execPath, [bin, 'mcp', ...args], {
    cwd, env: { ...process.env, CI: '1' },
  });
  const rawStdoutLines = [];
  const stderrChunks = [];
  const pending = new Map();
  let buffer = '';
  let nextId = 1;

  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let idx = buffer.indexOf('\n');
    while (idx >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (line.trim().length > 0) rawStdoutLines.push(line);
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && pending.has(msg.id)) {
          pending.get(msg.id)(msg);
          pending.delete(msg.id);
        }
      } catch {
        // Leave non-JSON lines in rawStdoutLines; the purity test
        // will name them.
      }
      idx = buffer.indexOf('\n');
    }
  });
  child.stderr.on('data', (c) => stderrChunks.push(c.toString('utf8')));

  const exited = new Promise((resolveExit) => {
    child.on('exit', (code, signal) => resolveExit({ code, signal }));
  });

  function request(method, params) {
    const id = nextId++;
    const message = { jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) };
    child.stdin.write(`${JSON.stringify(message)}\n`);
    return new Promise((resolveReq, rejectReq) => {
      const timer = setTimeout(() => rejectReq(new Error(`timeout waiting for ${method}`)), 10000);
      pending.set(id, (msg) => { clearTimeout(timer); resolveReq(msg); });
    });
  }

  function notify(method, params) {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, ...(params !== undefined ? { params } : {}) })}\n`);
  }

  async function initialize() {
    const response = await request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'e2e-test', version: '0.0.0' },
    });
    notify('notifications/initialized');
    return response;
  }

  return {
    child,
    request,
    notify,
    initialize,
    exited,
    rawStdoutLines,
    stderr: () => stderrChunks.join(''),
    end: () => child.stdin.end(),
  };
}

test('e2e: full handshake - initialize fields, version constant, ping, EOF exit 0', async () => {
  const tmp = await scaffold();
  const server = spawnServer(tmp);
  const init = await server.initialize();
  assert.equal(init.result.protocolVersion, '2025-11-25');
  assert.deepEqual(init.result.capabilities, { tools: {}, resources: {}, prompts: {} });
  assert.equal(init.result.serverInfo.name, 'rcf-build-lite');
  assert.equal(typeof init.result.instructions, 'string');
  const ping = await server.request('ping');
  assert.deepEqual(ping.result, {});
  server.end();
  const { code } = await server.exited;
  assert.equal(code, 0);
  assert.match(server.stderr(), /rcf mcp: serving/);
});

test('e2e: tools/list returns all eleven tools with schemas', async () => {
  const tmp = await scaffold();
  const server = spawnServer(tmp);
  await server.initialize();
  const { result } = await server.request('tools/list', {});
  assert.equal(result.tools.length, 11);
  for (const tool of result.tools) {
    assert.match(tool.name, /^rcf_/);
    assert.equal(typeof tool.inputSchema, 'object');
    assert.equal(typeof tool.outputSchema, 'object');
  }
  server.end();
  await server.exited;
});

test('e2e: one tools/call per tool class - validate (zero-arg), coverage (query), read (doc), build (bundle)', async () => {
  const tmp = await scaffold();
  const server = spawnServer(tmp);
  await server.initialize();
  const validate = await server.request('tools/call', { name: 'rcf_validate', arguments: {} });
  assert.deepEqual(validate.result.structuredContent, { ok: true, issues: [] });
  const coverage = await server.request('tools/call', { name: 'rcf_coverage', arguments: { strict: true } });
  assert.equal(coverage.result.structuredContent.strict, true);
  assert.equal(coverage.result.isError, undefined);
  const read = await server.request('tools/call', { name: 'rcf_read', arguments: { id: 'AC-101-1' } });
  assert.equal(read.result.structuredContent.value.id, 'AC-101-1');
  const build = await server.request('tools/call', { name: 'rcf_build', arguments: { fbsId: 'FBS-001' } });
  assert.equal(build.result.structuredContent.mode, 'bundle');
  assert.equal(build.result.structuredContent.fbs.fbsId, 'FBS-001');
  server.end();
  await server.exited;
});

test('e2e: write-tool round-trip is visible on disk', async () => {
  const tmp = await scaffold();
  const server = spawnServer(tmp);
  await server.initialize();
  const update = await server.request('tools/call', {
    name: 'rcf_update',
    arguments: { id: 'US-101', sets: [{ path: 'title', value: 'Written over MCP' }] },
  });
  assert.equal(update.result.isError, undefined);
  const onDisk = JSON.parse(await readFile(join(tmp, 'rcf/user-stories/us-101.json'), 'utf8'));
  assert.equal(onDisk.title, 'Written over MCP');
  server.end();
  await server.exited;
});

test('e2e: resources and prompts served over real pipes', async () => {
  const tmp = await scaffold();
  const server = spawnServer(tmp);
  await server.initialize();
  const list = await server.request('resources/list', {});
  const uris = list.result.resources.map((r) => r.uri);
  assert.ok(uris.includes('rcf://tree'));
  assert.ok(uris.includes('rcf://docs/overview'));
  const tree = await server.request('resources/read', { uri: 'rcf://tree' });
  assert.equal(JSON.parse(tree.result.contents[0].text).project, 'McpE2eTest');
  const prompts = await server.request('prompts/list', {});
  assert.equal(prompts.result.prompts.length, 2);
  const playbook = await server.request('prompts/get', { name: 'rcf_execute_build_cycle' });
  assert.equal(playbook.result.messages[0].role, 'user');
  assert.ok(playbook.result.messages[0].content.text.length > 100);
  server.end();
  await server.exited;
});

test('e2e: protocol errors over real pipes - unknown tool -32602, unknown method -32601, parse error -32700', async () => {
  const tmp = await scaffold();
  const server = spawnServer(tmp);
  await server.initialize();
  const unknownTool = await server.request('tools/call', { name: 'rcf_nope', arguments: {} });
  assert.equal(unknownTool.error.code, -32602);
  const unknownMethod = await server.request('no/such/method', {});
  assert.equal(unknownMethod.error.code, -32601);
  server.child.stdin.write('NOT JSON AT ALL\n');
  const ping = await server.request('ping');
  assert.deepEqual(ping.result, {}, 'loop survives a parse error');
  server.end();
  await server.exited;
  const parseErrors = server.rawStdoutLines
    .map((l) => JSON.parse(l))
    .filter((m) => m.error?.code === -32700);
  assert.equal(parseErrors.length, 1);
  assert.equal(parseErrors[0].id, null);
});

test('e2e: stdout purity - every stdout line is a valid JSON-RPC message, nothing else', async () => {
  const tmp = await scaffold();
  const server = spawnServer(tmp);
  await server.initialize();
  await server.request('tools/list', {});
  await server.request('tools/call', { name: 'rcf_coverage', arguments: {} });
  await server.request('tools/call', { name: 'rcf_trace', arguments: { id: 'NOPE-1' } });
  await server.request('resources/read', { uri: 'rcf://docs/build-cycle' });
  server.end();
  await server.exited;
  assert.ok(server.rawStdoutLines.length >= 5);
  for (const line of server.rawStdoutLines) {
    let message;
    assert.doesNotThrow(() => { message = JSON.parse(line); }, `non-JSON on stdout: ${line.slice(0, 80)}`);
    assert.equal(message.jsonrpc, '2.0', `non-JSON-RPC message on stdout: ${line.slice(0, 80)}`);
    assert.equal(line.includes('\r'), false);
  }
});

test('e2e: verbose logging goes to stderr, never stdout', async () => {
  const tmp = await scaffold();
  const server = spawnServer(tmp, ['--verbose']);
  await server.initialize();
  await server.request('tools/call', { name: 'rcf_validate', arguments: {} });
  server.end();
  await server.exited;
  assert.match(server.stderr(), /tools\/call rcf_validate/);
  for (const line of server.rawStdoutLines) {
    assert.doesNotThrow(() => JSON.parse(line));
  }
});

test('e2e: no project root - exit 2, stderr line, zero stdout traffic', async () => {
  const bare = await mkdtemp(join(tmpdir(), 'rcf-mcp-noroot-'));
  const server = spawnServer(bare);
  const { code } = await server.exited;
  assert.equal(code, 2);
  assert.match(server.stderr(), /no project root found/);
  assert.equal(server.rawStdoutLines.length, 0, 'nothing may reach stdout before root resolution');
  // B3 (E2E matrix 2026-07-06-003): an MCP client renders this failure
  // as "zero tools" with no visible error, so the stderr line must be
  // actionable - name the recovery verb and the doc that explains it.
  // Theme 1 funnel: the recovery is `npx rcf init` + a session restart.
  assert.match(server.stderr(), /run `npx rcf init` in the project first/);
  assert.match(server.stderr(), /then restart your agent\s+session/);
  assert.match(server.stderr(), /--project-root <path>/);
  assert.match(server.stderr(), /docs\/install\.md, section 7/);
});

test('e2e: SIGTERM exits cleanly', async () => {
  const tmp = await scaffold();
  const server = spawnServer(tmp);
  await server.initialize();
  server.child.kill('SIGTERM');
  const { code, signal } = await server.exited;
  assert.equal(signal, null, 'handler runs; not killed by default disposition');
  assert.equal(code, 0);
});

test('e2e: --project-root serves a project from elsewhere', async () => {
  const tmp = await scaffold();
  const elsewhere = await mkdtemp(join(tmpdir(), 'rcf-mcp-elsewhere-'));
  const server = spawnServer(elsewhere, ['--project-root', tmp]);
  const init = await server.initialize();
  assert.equal(init.result.protocolVersion, '2025-11-25');
  const validate = await server.request('tools/call', { name: 'rcf_validate', arguments: {} });
  assert.equal(validate.result.structuredContent.ok, true);
  server.end();
  await server.exited;
});
