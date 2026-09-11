// Redaction-boundary probe for observability-logging.
//
// Emits payloads whose fields carry recommended-default PII category
// names at top-level (credential/token/bearer) and inside a nested
// object at path pii.email / pii.name / pii.address. Asserts:
//   - the emitted line replaces the value with '[REDACTED:<category>]'
//     on every match regardless of call-site, AND
//   - the caller's original payload object is not mutated after the
//     log call returns (both clauses on AC-15103-1).
//
// AC-15103-4 requires the SPECIFIC shape `{ user: { id: "u-1",
// pii: { email: "a@b" } } }` with `user.id` PRESERVED and
// `user.pii.email` redacted. This probe emits both the top-level
// pii: {...} shape (three nested-path rows) AND the AC-15103-4 shape
// (preserved user.id + redacted user.pii.email). The three nested-
// path rows are de-claimed (conformanceOnly, anchorAcId=null) with
// the limitation naming AC-15103-4; the AC-15103-4-shaped row is
// anchored as a real AC.
//
// AC-15103-3 (unrecognised category left unredacted) requires a
// specifically-shaped `custom.internal.token`-style field name. A
// bare `note` field does not exercise the "valid-but-unconfigured
// kebab/dotted grammar" the AC names. Row de-claimed with the
// limitation naming AC-15103-3.
import { createLogger } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-observability-logging/src/logger-factory.mjs';

export const anchorAcId = 'AC-15103-1';
export const accountBound = false;
const AC1 = 'A log payload containing a field named or';
const AC4 = 'The redaction boundary reads a nested payload path:';
const AC4_LIM_NEST = `AC-15103-4: specifically requires the shape { user: { id: "u-1", pii: { email: "a@b" } } } with user.id PRESERVED and user.pii.email REDACTED. A top-level pii: {...} object with no user wrapper and no preserved sibling id does not exercise the AC's shape.`;
const AC3_LIM_NOTE = `AC-15103-3: requires a valid-but-unconfigured category name (kebab or dotted-namespace grammar), e.g. custom.internal.token, that looks like a redaction path but is not in defaults or additions. A bare field name 'note' with no category-shaped label does not exercise the AC's grammar constraint.`;

function deepClone(v) { return JSON.parse(JSON.stringify(v)); }
function sameShape(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

export default async function runProbe() {
  const outBuf = [];
  const log = createLogger({ environment: 'qa', serviceName: 'probe-svc', serviceVersion: '0.0.1', outSink: (s) => outBuf.push(s), errSink: () => {} });
  const payload = { credential: 'SAMPLE_CRED_VALUE', token: 'SAMPLE_TOKEN_VALUE', bearer: 'SAMPLE_BEARER_VALUE', pii: { email: 'sample@example.com', name: 'Sample Person', address: '1 Sample St' }, note: 'this stays' };
  const beforePayload = deepClone(payload);
  log.info('with-pii', payload);
  const payloadUnmutated = sameShape(payload, beforePayload);
  const line1 = JSON.parse(outBuf.join('').split('\n').filter(Boolean)[0]);

  // AC-15103-4-shaped emission: { user: { id: 'u-1', pii: { email: 'a@b' } } }.
  outBuf.length = 0;
  const acShapedPayload = { user: { id: 'u-1', pii: { email: 'a@b' } } };
  const acShapedBefore = deepClone(acShapedPayload);
  log.info('ac-15103-4-shape', acShapedPayload);
  const acShapedUnmutated = sameShape(acShapedPayload, acShapedBefore);
  const acShapedLine = JSON.parse(outBuf.join('').split('\n').filter(Boolean)[0]);

  const results = [];
  const topLevel = [
    { path: 'credential', expected: '[REDACTED:credential]', got: line1.credential },
    { path: 'token', expected: '[REDACTED:token]', got: line1.token },
    { path: 'bearer', expected: '[REDACTED:bearer]', got: line1.bearer },
  ];
  for (const c of topLevel) {
    results.push({
      anchorAcId: 'AC-15103-1',
      verdict: c.got === c.expected && payloadUnmutated ? 'pass' : 'fail',
      detail: `${AC1}  -  top-level field '${c.path}' folded to '${c.got}'; expected '${c.expected}'; caller payload unmutated=${payloadUnmutated}; observes both AC-15103-1 clauses (redacted output AND caller object not mutated).`,
      evidence: { path: c.path, valueOnLine: c.got, payloadUnmutated, line: { correlationId: line1.correlationId ?? null, level: line1.level, message: line1.message, [c.path]: c.got } },
    });
  }
  const nested = [
    { path: 'pii.email', expected: '[REDACTED:pii.email]', got: line1.pii?.email },
    { path: 'pii.name', expected: '[REDACTED:pii.name]', got: line1.pii?.name },
    { path: 'pii.address', expected: '[REDACTED:pii.address]', got: line1.pii?.address },
  ];
  for (const c of nested) {
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: AC4_LIM_NEST,
      verdict: c.got === c.expected ? 'pass' : 'fail',
      detail: `observed nested path '${c.path}' folded to '${c.got}'; expected '${c.expected}' at top-level pii: {...} shape (no user wrapper, no preserved sibling id).`,
      evidence: { path: c.path, valueOnLine: c.got, line: { correlationId: line1.correlationId ?? null, level: line1.level, message: line1.message, pii: line1.pii } },
    });
  }
  results.push({
    anchorAcId: null,
    conformanceOnly: true,
    limitation: AC3_LIM_NOTE,
    verdict: line1.note === 'this stays' ? 'pass' : 'fail',
    detail: `observed negative-control top-level field 'note'='${line1.note}' (no category tag at all -- passes through unredacted).`,
    evidence: { note: line1.note, valueOnLine: line1.note, line: { correlationId: line1.correlationId ?? null, level: line1.level, message: line1.message, note: line1.note } },
  });

  const emailRedactedOk = acShapedLine.user?.pii?.email === '[REDACTED:pii.email]';
  const idPreservedOk = acShapedLine.user?.id === 'u-1';
  results.push({
    anchorAcId: 'AC-15103-4',
    verdict: emailRedactedOk && idPreservedOk && acShapedUnmutated ? 'pass' : 'fail',
    detail: `${AC4}  -  observed emitted line with payload { user: { id: 'u-1', pii: { email: 'a@b' } } }: user.id='${acShapedLine.user?.id}' (expect 'u-1' PRESERVED); user.pii.email='${acShapedLine.user?.pii?.email}' (expect '[REDACTED:pii.email]'); acShapedPayload unmutated=${acShapedUnmutated}.`,
    evidence: { userIdOnLine: acShapedLine.user?.id, userPiiEmailOnLine: acShapedLine.user?.pii?.email, acShapedUnmutated, line: { correlationId: acShapedLine.correlationId ?? null, level: acShapedLine.level, message: acShapedLine.message, user: acShapedLine.user } },
  });

  return { results, extra: { envDeclared: ['RCF_FIXTURE_LOGGER_CORRELATION_HEADER'], excerpt: line1, acShapedExcerpt: acShapedLine, payloadUnmutated, acShapedUnmutated } };
}
