// Redaction-boundary probe for observability-logging.
// Emits payloads whose fields carry recommended-default PII category
// names at top-level (credential/token/bearer) and inside a nested
// object at path pii.email / pii.name / pii.address (AC-15103-4 nested
// path shape). Asserts the emitted line replaces the value with
// '[REDACTED:<category>]' on every match regardless of call-site.
// A negative control field ('note') proves redaction, not a
// serialiser bug.
//
// Positive evidence: the JSON line's redacted value string equals
// the exact category label; the negative control passes through.
//
// Anchors:
//   - AC-15103-1 for the recommended-default categories at top level
//     (credential, token, bearer)  -  the AC lists all six defaults
//     including credential/token/bearer.
//   - AC-15103-4 for the nested path shape user.pii.email etc.
//     (leaves redacted, siblings preserved).
//   - AC-15103-3 for the 'note' pass-through: 'note' carries no
//     category tag at all, so the boundary leaves it verbatim (the
//     same behaviour AC-15103-3 asserts for a name that isn't in
//     defaults or additions).
// accountBound: false.

import { createLogger } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-observability-logging/src/logger-factory.mjs';

export const anchorAcId = 'AC-15103-1';
export const accountBound = false;
const AC1 = 'A log payload containing a field named or';
const AC3 = 'A category name whose kebab or dotted-namespace grammar';
const AC4 = 'The redaction boundary reads a nested payload path:';

export default async function runProbe() {
  const outBuf = [];
  const log = createLogger({ environment: 'qa', serviceName: 'probe-svc', serviceVersion: '0.0.1', outSink: (s) => outBuf.push(s), errSink: () => {} });
  const payload = { credential: 'SAMPLE_CRED_VALUE', token: 'SAMPLE_TOKEN_VALUE', bearer: 'SAMPLE_BEARER_VALUE', pii: { email: 'sample@example.com', name: 'Sample Person', address: '1 Sample St' }, note: 'this stays' };
  log.info('with-pii', payload);
  const line = JSON.parse(outBuf.join('').split('\n').filter(Boolean)[0]);
  const results = [];
  const topLevel = [
    { path: 'credential', expected: '[REDACTED:credential]', got: line.credential },
    { path: 'token', expected: '[REDACTED:token]', got: line.token },
    { path: 'bearer', expected: '[REDACTED:bearer]', got: line.bearer },
  ];
  for (const c of topLevel) {
    results.push({
      anchorAcId: 'AC-15103-1',
      verdict: c.got === c.expected ? 'pass' : 'fail',
      detail: `${AC1}  -  top-level field '${c.path}' folded to '${c.got}'; expected '${c.expected}'; observed by emitting a recommended-default category value at top-level per AC-15103-1.`,
      evidence: { path: c.path, valueOnLine: c.got },
    });
  }
  const nested = [
    { path: 'pii.email', expected: '[REDACTED:pii.email]', got: line.pii?.email },
    { path: 'pii.name', expected: '[REDACTED:pii.name]', got: line.pii?.name },
    { path: 'pii.address', expected: '[REDACTED:pii.address]', got: line.pii?.address },
  ];
  for (const c of nested) {
    results.push({
      anchorAcId: 'AC-15103-4',
      verdict: c.got === c.expected ? 'pass' : 'fail',
      detail: `${AC4}  -  nested path '${c.path}' folded to '${c.got}'; expected '${c.expected}'; observed by emitting the value inside a nested { pii: { ... } } object per AC-15103-4 (nested path redaction).`,
      evidence: { path: c.path, valueOnLine: c.got },
    });
  }
  results.push({
    anchorAcId: 'AC-15103-3',
    verdict: line.note === 'this stays' ? 'pass' : 'fail',
    detail: `${AC3}  -  negative-control top-level field 'note'='${line.note}' (no category tag at all  -  passes through unredacted, mirroring AC-15103-3's "unrecognised category left unredacted" behaviour).`,
    evidence: { note: line.note, valueOnLine: line.note },
  });
  return { results, extra: { envDeclared: ['RCF_FIXTURE_LOGGER_CORRELATION_HEADER'], excerpt: line } };
}
