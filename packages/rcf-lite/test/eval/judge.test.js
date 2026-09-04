// LLM-as-judge invocation shape. Stubs the spawn seam so no live
// process is required. A real subprocess round-trip is exercised
// separately in the section 11 real-claude smoke.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import {
  appendRunRecord,
  composeRunRecord,
  runOneCase,
  spawnAndCollect,
} from '../../src/eval/judge.js';

function makeFakeChild({ stdoutText = '', stderrText = '', exitCode = 0 } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = {
    end(_body) {
      queueMicrotask(() => {
        if (stdoutText) child.stdout.emit('data', Buffer.from(stdoutText));
        if (stderrText) child.stderr.emit('data', Buffer.from(stderrText));
        child.emit('close', exitCode);
      });
    },
  };
  child.kill = () => {};
  return child;
}

test('spawnAndCollect returns stdout on exit 0', async () => {
  const spawnImpl = () => makeFakeChild({ stdoutText: '{"ok":true}\n', exitCode: 0 });
  const out = await spawnAndCollect('claude', [], '', { spawnImpl, timeoutMs: 500 });
  assert.equal(out.stdout, '{"ok":true}\n');
  assert.equal(out.code, 0);
});

test('spawnAndCollect surfaces non-zero exit as ioFailure with stderr excerpt', async () => {
  const spawnImpl = () => makeFakeChild({ stderrText: 'auth expired', exitCode: 1 });
  const out = await spawnAndCollect('claude', [], '', { spawnImpl, timeoutMs: 500 });
  assert.equal(out.kind, 'ioFailure');
  assert.match(out.message, /exited with code 1/);
  assert.match(out.message, /auth expired/);
});

test('runOneCase returns the parsed graded envelope on a valid response', async () => {
  const evalDoc = {
    id: 'EVAL-001',
    judge: {
      type: 'llmJudge',
      harness: {
        invoker: 'claude',
        responseSchemaPath: 'schemas/judge.json',
      },
    },
    criteria: [{ id: 'voice-fit', description: 'reads as Barry' }],
  };
  const caseDoc = { id: 'greeting', input: { prompt: 'hi' } };
  const gradedText = JSON.stringify({
    perCriterion: [{ id: 'voice-fit', score: 0.9 }],
    aggregateScore: 0.9,
  });
  const spawnImpl = () => makeFakeChild({ stdoutText: gradedText });
  const out = await runOneCase({
    evalDoc,
    caseDoc,
    spawnImpl,
    responseSchema: {
      type: 'object',
      required: ['perCriterion'],
      properties: {
        perCriterion: { type: 'array' },
        aggregateScore: { type: 'number' },
      },
    },
    timeoutMs: 500,
  });
  assert.equal(out.invoker, 'claude');
  assert.equal(out.graded.aggregateScore, 0.9);
});

test('runOneCase refuses an invoker outside the {claude, codex} enum', async () => {
  const evalDoc = { id: 'EVAL-001', judge: { harness: { invoker: 'openai' } } };
  const out = await runOneCase({ evalDoc, caseDoc: {}, spawnImpl: () => makeFakeChild(), timeoutMs: 500 });
  assert.equal(out.kind, 'usage');
  assert.match(out.message, /unsupported invoker/);
});

test('composeRunRecord produces a pass verdict when aggregate meets threshold and no critical failures', () => {
  const evalDoc = {
    criteria: [{ id: 'voice-fit', description: 'x' }],
    passThreshold: { aggregateScore: 0.8, criticalMustPass: true },
  };
  const record = composeRunRecord({
    evalDoc,
    cases: [{ caseId: 'greeting', graded: { perCriterion: [{ id: 'voice-fit', score: 0.9 }] } }],
    runner: 'claude-cli:0.0.1',
    now: new Date('2026-09-04T20:00:00Z'),
  });
  assert.equal(record.verdict, 'pass');
  assert.equal(record.aggregateScore, 0.9);
});

test('composeRunRecord produces a fail verdict when a critical criterion fails', () => {
  const evalDoc = {
    criteria: [{ id: 'safety', description: 'x', critical: true }],
    passThreshold: { aggregateScore: 0.1, criticalMustPass: true },
  };
  const record = composeRunRecord({
    evalDoc,
    cases: [{
      caseId: 'greeting',
      graded: { perCriterion: [{ id: 'safety', score: 0.5, criticalPass: false }] },
    }],
    runner: 'claude-cli:0.0.1',
  });
  assert.equal(record.verdict, 'fail');
  assert.equal(record.criticalFailures.length, 1);
});

test('appendRunRecord returns a new doc with the record appended', () => {
  const doc = { id: 'EVAL-1', runRecord: [] };
  const record = { verdict: 'pass' };
  const next = appendRunRecord({ evalDoc: doc, runRecord: record });
  assert.notEqual(next, doc);
  assert.equal(next.runRecord.length, 1);
  assert.equal(next.runRecord[0].verdict, 'pass');
});
