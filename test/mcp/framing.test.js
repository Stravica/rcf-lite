// Framing layer tests (Phase 7 §D20 unit layer): newline-delimited
// read / write over injectable streams. No subprocess.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';

import { attachLineReader, serialiseMessage, writeMessage } from '../../src/mcp/framing.js';

function collect(stream) {
  const messages = [];
  const parseErrors = [];
  let ended = false;
  attachLineReader(stream, {
    onMessage: (m) => messages.push(m),
    onParseError: (raw, err) => parseErrors.push({ raw, err }),
    onEnd: () => { ended = true; },
  });
  return { messages, parseErrors, isEnded: () => ended };
}

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('framing: one message per line, multiple lines per chunk', async () => {
  const stream = new PassThrough();
  const { messages } = collect(stream);
  stream.write('{"a":1}\n{"b":2}\n');
  await tick();
  assert.deepEqual(messages, [{ a: 1 }, { b: 2 }]);
});

test('framing: a line split across chunk boundaries reassembles', async () => {
  const stream = new PassThrough();
  const { messages } = collect(stream);
  stream.write('{"jsonrpc":"2.0","me');
  stream.write('thod":"ping","id":1}');
  stream.write('\n');
  await tick();
  assert.deepEqual(messages, [{ jsonrpc: '2.0', method: 'ping', id: 1 }]);
});

test('framing: blank lines and CRLF line endings are tolerated', async () => {
  const stream = new PassThrough();
  const { messages, parseErrors } = collect(stream);
  stream.write('\n   \n{"a":1}\r\n\n{"b":2}\n');
  await tick();
  assert.deepEqual(messages, [{ a: 1 }, { b: 2 }]);
  assert.equal(parseErrors.length, 0);
});

test('framing: a parse failure surfaces and later lines still parse', async () => {
  const stream = new PassThrough();
  const { messages, parseErrors } = collect(stream);
  stream.write('{not json}\n{"ok":true}\n');
  await tick();
  assert.equal(parseErrors.length, 1);
  assert.equal(parseErrors[0].raw, '{not json}');
  assert.deepEqual(messages, [{ ok: true }]);
});

test('framing: trailing unterminated line is emitted at EOF and onEnd fires', async () => {
  const stream = new PassThrough();
  const { messages, isEnded } = collect(stream);
  stream.write('{"last":true}');
  stream.end();
  await tick();
  assert.deepEqual(messages, [{ last: true }]);
  assert.equal(isEnded(), true);
});

test('framing: multibyte UTF-8 split across chunk boundaries survives', async () => {
  const stream = new PassThrough();
  const { messages } = collect(stream);
  const raw = Buffer.from('{"text":"café → très"}\n', 'utf8');
  // Split inside the two-byte e-acute sequence.
  const splitAt = raw.indexOf(0xc3) + 1;
  stream.write(raw.subarray(0, splitAt));
  stream.write(raw.subarray(splitAt));
  await tick();
  assert.deepEqual(messages, [{ text: 'café → très' }]);
});

test('framing: serialiseMessage emits a single line even for newline-bearing strings', () => {
  const line = serialiseMessage({ text: 'two\nlines' });
  assert.equal(line.includes('\n'), false);
  assert.deepEqual(JSON.parse(line), { text: 'two\nlines' });
});

test('framing: serialiseMessage refuses values that do not serialise to JSON', () => {
  assert.throws(() => serialiseMessage(undefined), TypeError);
});

test('framing: writeMessage newline-terminates exactly once', async () => {
  const out = new PassThrough();
  const chunks = [];
  out.on('data', (c) => chunks.push(c.toString('utf8')));
  writeMessage(out, { jsonrpc: '2.0', id: 1, result: {} });
  await tick();
  const written = chunks.join('');
  assert.equal(written, '{"jsonrpc":"2.0","id":1,"result":{}}\n');
});
