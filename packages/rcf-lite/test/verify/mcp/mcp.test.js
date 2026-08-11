// MCP adapter tests (spec §10 MCP): thin adapter over the same in-process
// engine, reusing the core protocol shell; handshake against the pinned MCP
// revision; closed camelCase input schema; tool input-validation maps to
// tool-execution errors (isError:true), not protocol errors.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createMcpServer, PROTOCOL_VERSION } from '@stravica-ai/rcf-lite-core/mcp-shell';
import { createToolRegistry } from '../../src/mcp/tools.js';
import { scaffoldChain, stubLauncher } from '../helpers/chain.js';

const passFinding = { severity: 'PASS', acId: 'AC-101-3', journey: 'landing', reproSteps: ['load /'], evidence: { detail: 'ok' } };

function serverWith(deps) {
  const tools = createToolRegistry(deps);
  return createMcpServer({
    serverInfo: { name: 'rcf-verify-lite', version: '0.0.0' },
    capabilities: { tools: {} },
    handlers: {
      'tools/list': async () => ({ tools: tools.definitions }),
      'tools/call': async (params) => tools.call(params.name, params.arguments),
    },
  });
}

test('handshake: initialize responds with the pinned protocol version', async () => {
  const server = serverWith({});
  const res = await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.equal(res.result.protocolVersion, PROTOCOL_VERSION);
  assert.equal(res.result.serverInfo.name, 'rcf-verify-lite');
});

test('tools/list: exposes rcf_verify_run with a closed camelCase input schema', async () => {
  const server = serverWith({});
  const res = await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const tool = res.result.tools.find((t) => t.name === 'rcf_verify_run');
  assert.ok(tool);
  assert.equal(tool.inputSchema.additionalProperties, false); // closed object
  assert.deepEqual(tool.inputSchema.required.sort(), ['profile', 'repo', 'url']);
  assert.ok(tool.inputSchema.properties.parityEnv); // camelCase, not parity-env
});

test('tools/call: missing required args -> tool execution error (isError:true), not a protocol error', async () => {
  const registry = createToolRegistry({});
  const result = await registry.call('rcf_verify_run', { profile: 'ci' }); // no repo, no url
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.ok, false);
  assert.ok(result.structuredContent.errors.length >= 2);
});

test('tools/call: unknown tool throws a protocol INVALID_PARAMS error', async () => {
  const registry = createToolRegistry({});
  await assert.rejects(() => registry.call('nope', {}), /Unknown tool/);
});

test('tools/call: valid args (stubbed launcher) return the report as structuredContent', async () => {
  const { root } = await scaffoldChain();
  const registry = createToolRegistry({ launchAgent: stubLauncher([passFinding]), now: () => '2026-07-21T12:00:00.000Z' });
  const result = await registry.call('rcf_verify_run', { repo: root, profile: 'ci', url: 'http://localhost:3000', provisionMode: 'skip' });
  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.ok, true);
  assert.equal(result.structuredContent.report.verdict, 'PASS');
  assert.equal(result.structuredContent.report.verdictAuthority, 'correctness');
});

test('tools/call: severityGate reflected in gateTripped without changing the report', async () => {
  const { root } = await scaffoldChain();
  const broken = { severity: 'BROKEN', acId: 'AC-101-1', journey: 'sign-in', reproSteps: ['500'], evidence: { detail: 'auth 500' } };
  const registry = createToolRegistry({ launchAgent: stubLauncher([broken]), now: () => 'x' });
  const result = await registry.call('rcf_verify_run', { repo: root, profile: 'ci', url: 'http://localhost:3000', provisionMode: 'skip', severityGate: 'BROKEN' });
  assert.equal(result.structuredContent.gateTripped, true);
  assert.equal(result.structuredContent.report.verdict, 'BROKEN');
});
