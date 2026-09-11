// Redaction-boundary probe for observability-logging v1.3.1.
// Emits payloads whose fields carry PII category names at various
// nesting depths; asserts the emitted line replaces the value with
// '[REDACTED:<category>]' on every match regardless of call-site.
// A negative control field ('note') proves redaction, not a
// serialiser bug.
//
// Positive evidence: the JSON line's redacted value string equals
// the exact category label; the negative control passes through.
// anchorAcId: AC-15103-1. accountBound: false.

import { createLogger } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-observability-logging/src/logger-factory.mjs';

export const anchorAcId = 'AC-15103-1';
export const accountBound = false;

export default async function runProbe() {
  const outBuf = [];
  const log = createLogger({ environment: 'qa', serviceName: 'probe-svc', serviceVersion: '0.0.1', outSink: (s) => outBuf.push(s), errSink: () => {} });
  const payload = { credential: 'hunter2', token: 'tok-abc', bearer: 'Bearer xyz', pii: { email: 'x@example.com', name: 'Baz', address: '1 Road' }, note: 'this stays' };
  log.info('with-pii', payload);
  const line = JSON.parse(outBuf.join('').split('\n').filter(Boolean)[0]);
  const results = [];
  const cases = [
    { path: 'credential', expected: '[REDACTED:credential]', got: line.credential, ac: 'AC-15103-1' },
    { path: 'token', expected: '[REDACTED:token]', got: line.token, ac: 'AC-15103-1' },
    { path: 'bearer', expected: '[REDACTED:bearer]', got: line.bearer, ac: 'AC-15103-1' },
    { path: 'pii.email', expected: '[REDACTED:pii.email]', got: line.pii?.email, ac: 'AC-15103-2' },
    { path: 'pii.name', expected: '[REDACTED:pii.name]', got: line.pii?.name, ac: 'AC-15103-2' },
    { path: 'pii.address', expected: '[REDACTED:pii.address]', got: line.pii?.address, ac: 'AC-15103-2' },
  ];
  for (const c of cases) {
    results.push({
      anchorAcId: c.ac,
      verdict: c.got === c.expected ? 'pass' : 'fail',
      detail: `field '${c.path}' folded to '${c.got}'; expected '${c.expected}'`,
      evidence: { path: c.path, valueOnLine: c.got },
    });
  }
  results.push({
    anchorAcId: 'AC-15103-3',
    verdict: line.note === 'this stays' ? 'pass' : 'fail',
    detail: `negative-control field 'note'='${line.note}' (unchanged pass-through)`,
    evidence: { note: line.note },
  });
  return { results, extra: { envDeclared: ['RCF_FIXTURE_LOGGER_CORRELATION_HEADER'], excerpt: line } };
}
