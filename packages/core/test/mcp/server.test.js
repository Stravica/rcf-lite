// Protocol lifecycle tests (Phase 7 §D3 / §D18 / §D20 unit layer)
// against injected streams - no subprocess. The server core is pure
// protocol; domain handlers are stubbed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';

import {
  createMcpServer,
  serveStreams,
  JsonRpcError,
  PROTOCOL_VERSION,
  INVALID_PARAMS,
} from '../../src/mcp/server.js';

function makeServer(overrides = {}) {
  return createMcpServer({
    serverInfo: { name: 'rcf-build-lite', version: '0.0.0' },
    instructions: 'test instructions',
    capabilities: { tools: {}, resources: {}, prompts: {} },
    handlers: {
      'test/echo': async (params) => ({ echoed: params }),
      'test/protocolError': async () => { throw new JsonRpcError(INVALID_PARAMS, 'bad params', { hint: 'x' }); },
      'test/boom': async () => { throw new Error('kaboom'); },
      ...overrides.handlers,
    },
    log: overrides.log,
  });
}

test('initialize responds with the pinned protocol version regardless of the requested one', async () => {
  const server = makeServer();
  const response = await server.handleMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2099-01-01', capabilities: {}, clientInfo: { name: 'c', version: '1' } },
  });
  assert.equal(response.result.protocolVersion, PROTOCOL_VERSION);
  assert.equal(response.result.protocolVersion, '2025-11-25');
});

test('initialize declares tools + resources + prompts capabilities, serverInfo and instructions', async () => {
  const server = makeServer();
  const { result } = await server.handleMessage({
    jsonrpc: '2.0', id: 1, method: 'initialize', params: {},
  });
  assert.deepEqual(result.capabilities, { tools: {}, resources: {}, prompts: {} });
  assert.deepEqual(result.serverInfo, { name: 'rcf-build-lite', version: '0.0.0' });
  assert.equal(result.instructions, 'test instructions');
});

test('ping answers {} and works before initialize', async () => {
  const server = makeServer();
  const response = await server.handleMessage({ jsonrpc: '2.0', id: 7, method: 'ping' });
  assert.deepEqual(response, { jsonrpc: '2.0', id: 7, result: {} });
});

test('notifications/initialized flips the initialized flag; no response emitted', async () => {
  const server = makeServer();
  assert.equal(server.initialized(), false);
  const response = await server.handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(response, null);
  assert.equal(server.initialized(), true);
});

test('unknown notifications (including notifications/cancelled) are tolerated and ignored', async () => {
  const server = makeServer();
  assert.equal(await server.handleMessage({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } }), null);
  assert.equal(await server.handleMessage({ jsonrpc: '2.0', method: 'notifications/never/heard/of' }), null);
});

test('unknown method returns -32601', async () => {
  const server = makeServer();
  const response = await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'no/such/method' });
  assert.equal(response.error.code, -32601);
  assert.equal(response.id, 2);
});

test('malformed requests return -32600 with a null or echoed id', async () => {
  const server = makeServer();
  const noMethod = await server.handleMessage({ jsonrpc: '2.0', id: 3 });
  assert.equal(noMethod.error.code, -32600);
  assert.equal(noMethod.id, 3);
  const notObject = await server.handleMessage('just a string');
  assert.equal(notObject.error.code, -32600);
  assert.equal(notObject.id, null);
  const badVersion = await server.handleMessage({ jsonrpc: '1.0', id: 4, method: 'ping' });
  assert.equal(badVersion.error.code, -32600);
});

test('incoming responses are ignored (this server never sends requests)', async () => {
  const server = makeServer();
  assert.equal(await server.handleMessage({ jsonrpc: '2.0', id: 9, result: {} }), null);
  assert.equal(await server.handleMessage({ jsonrpc: '2.0', id: 9, error: { code: -1, message: 'x' } }), null);
});

test('handler JsonRpcError maps to a protocol error; unexpected throw maps to -32603 with stack on stderr only', async () => {
  const errorLines = [];
  const server = makeServer({ log: { info: () => {}, error: (l) => errorLines.push(l) } });
  const protocolErr = await server.handleMessage({ jsonrpc: '2.0', id: 5, method: 'test/protocolError' });
  assert.equal(protocolErr.error.code, INVALID_PARAMS);
  assert.deepEqual(protocolErr.error.data, { hint: 'x' });
  const internal = await server.handleMessage({ jsonrpc: '2.0', id: 6, method: 'test/boom' });
  assert.equal(internal.error.code, -32603);
  assert.match(internal.error.message, /kaboom/);
  assert.equal(internal.error.message.includes('at '), false, 'no stack frames in model context');
  assert.equal(errorLines.length, 1);
  assert.match(errorLines[0], /kaboom/);
});

test('serveStreams: parse errors answer -32700 and the loop keeps serving', async () => {
  const server = makeServer();
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks = [];
  output.on('data', (c) => chunks.push(c.toString('utf8')));
  serveStreams(server, { input, output });
  input.write('THIS IS NOT JSON\n');
  input.write('{"jsonrpc":"2.0","id":10,"method":"ping"}\n');
  await new Promise((resolve) => setTimeout(resolve, 20));
  const responses = chunks.join('').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(responses.length, 2);
  assert.equal(responses[0].error.code, -32700);
  assert.equal(responses[0].id, null);
  assert.deepEqual(responses[1], { jsonrpc: '2.0', id: 10, result: {} });
});

test('serveStreams: EOF on input resolves 0 (the stdio shutdown path)', async () => {
  const server = makeServer();
  const input = new PassThrough();
  const output = new PassThrough();
  const { done } = serveStreams(server, { input, output });
  input.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
  input.end();
  const code = await done;
  assert.equal(code, 0);
});

test('serveStreams: responses come back in request order over the serial queue', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const server = makeServer({
    handlers: {
      'test/slow': async () => { await gate; return { slow: true }; },
      'test/fast': async () => ({ fast: true }),
    },
  });
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks = [];
  output.on('data', (c) => chunks.push(c.toString('utf8')));
  serveStreams(server, { input, output });
  input.write('{"jsonrpc":"2.0","id":1,"method":"test/slow"}\n');
  input.write('{"jsonrpc":"2.0","id":2,"method":"test/fast"}\n');
  await new Promise((resolve) => setTimeout(resolve, 10));
  release();
  await new Promise((resolve) => setTimeout(resolve, 10));
  const responses = chunks.join('').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(responses.map((r) => r.id), [1, 2]);
});
