// Unit tests for the shared anatomy helper. Locks in the identifier-
// pairing equality rule: a probe-supplied value only qualifies as an
// identifier when the engine's echo of THAT specific value is recorded
// alongside it (same row, equal strings). Bare non-empty companions,
// bare `correlationIdEchoed` values and `linesExcerpt` substrings do
// not qualify.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resultHasEvidenceShape } from './_probe-anatomy-helpers.mjs';

const bodyDerived = 'response-body-excerpt';

function row(evidence) {
  return {
    anchorAcId: 'AC-9999-1',
    verdict: 'pass',
    detail: 'synthetic',
    evidence,
  };
}

test('supplied + derivedResponseHeader: equal strings pass', () => {
  const r = row({ suppliedInput: 'req-abc-123', derivedResponseHeader: 'req-abc-123', bodyExcerpt: bodyDerived });
  const out = resultHasEvidenceShape(r);
  assert.equal(out.ok, true, JSON.stringify(out));
});

test('supplied + derivedResponseHeader: unrelated non-empty strings fail (equality gap)', () => {
  const r = row({ suppliedInput: 'req-abc-123', derivedResponseHeader: 'something-else', bodyExcerpt: bodyDerived });
  const out = resultHasEvidenceShape(r);
  assert.equal(out.ok, false, JSON.stringify(out));
  assert.match(out.reason, /no non-empty identifier/);
});

test('supplied + echoedHeader: equal strings pass', () => {
  const r = row({ suppliedInput: 'req-xyz', echoedHeader: 'req-xyz', bodyExcerpt: bodyDerived });
  assert.equal(resultHasEvidenceShape(r).ok, true);
});

test('supplied + echoedHeader: unrelated strings fail', () => {
  const r = row({ suppliedInput: 'req-xyz', echoedHeader: 'req-other', bodyExcerpt: bodyDerived });
  assert.equal(resultHasEvidenceShape(r).ok, false);
});

test('observed[].supplied + observed[].echoedHeader: equal strings pass', () => {
  const r = row({ observed: [{ supplied: 'r1', echoedHeader: 'r1', status: 200 }], bodyExcerpt: bodyDerived });
  assert.equal(resultHasEvidenceShape(r).ok, true);
});

test('observed[].supplied + observed[].echoedHeader: unrelated strings fail', () => {
  const r = row({ observed: [{ supplied: 'r1', echoedHeader: 'r2', status: 200 }], bodyExcerpt: bodyDerived });
  assert.equal(resultHasEvidenceShape(r).ok, false);
});

test('observedRoundTrips[].supplied + headerEcho: equal strings pass', () => {
  const r = row({ observedRoundTrips: [{ supplied: 'cid-1', headerEcho: 'cid-1', bodySequence: 1, bodyHash: 'h', status: 200 }], bodyExcerpt: bodyDerived });
  assert.equal(resultHasEvidenceShape(r).ok, true);
});

test('observedRoundTrips[].supplied + headerEcho: unrelated strings fail', () => {
  const r = row({ observedRoundTrips: [{ supplied: 'cid-1', headerEcho: 'cid-2', bodySequence: 1, bodyHash: 'h', status: 200 }], bodyExcerpt: bodyDerived });
  assert.equal(resultHasEvidenceShape(r).ok, false);
});

test('bare correlationIdEchoed with a linesExcerpt substring no longer qualifies', () => {
  const cid = 'cid-substring-only';
  const r = row({ correlationIdEchoed: cid, linesExcerpt: [`{"level":"info","correlationId":"${cid}","message":"hi"}`], bodyExcerpt: bodyDerived });
  assert.equal(resultHasEvidenceShape(r).ok, false);
});

test('bare correlationIdEchoed matching line.correlationId without an explicit suppliedInput no longer qualifies', () => {
  const cid = 'cid-line-only';
  const r = row({ correlationIdEchoed: cid, line: { correlationId: cid, message: 'hi', level: 'info' }, bodyExcerpt: bodyDerived });
  assert.equal(resultHasEvidenceShape(r).ok, false);
});

test('suppliedInput === line.correlationId still passes (explicit supplied value)', () => {
  const cid = 'cid-explicit';
  const r = row({ suppliedInput: cid, line: { correlationId: cid, message: 'hi', level: 'info' }, bodyExcerpt: bodyDerived });
  assert.equal(resultHasEvidenceShape(r).ok, true);
});

test('variedInput === observed.echoedHeader (single-value pair) still passes', () => {
  const v = 'varied-1';
  const r = row({ variedInput: v, observed: { echoedHeader: v, status: 200 }, bodyExcerpt: bodyDerived });
  assert.equal(resultHasEvidenceShape(r).ok, true);
});

test('variedInput != observed.echoedHeader fails', () => {
  const r = row({ variedInput: 'a', observed: { echoedHeader: 'b', status: 200 }, bodyExcerpt: bodyDerived });
  assert.equal(resultHasEvidenceShape(r).ok, false);
});

test('engine-minted requestId alone still qualifies as identifier (engine-minted lane)', () => {
  const r = row({ requestId: 'server-minted-req-42', bodyExcerpt: bodyDerived });
  assert.equal(resultHasEvidenceShape(r).ok, true);
});

test('observedEmissions[].correlationId === line.correlationId without suppliedInput no longer qualifies', () => {
  const cid = 'e-cid-3';
  const r = row({ observedEmissions: [{ level: 'info', correlationId: cid }], line: { correlationId: cid, message: 'hi', level: 'info' }, bodyExcerpt: bodyDerived });
  assert.equal(resultHasEvidenceShape(r).ok, false);
});

test('observedEmissions[].correlationId matched to suppliedInput and line.correlationId qualifies', () => {
  const cid = 'e-cid-4';
  const r = row({ suppliedInput: cid, observedEmissions: [{ level: 'info', correlationId: cid }], line: { correlationId: cid, message: 'hi', level: 'info' }, bodyExcerpt: bodyDerived });
  assert.equal(resultHasEvidenceShape(r).ok, true);
});
