// Redaction-boundary probe for observability-logging.
//
// Emits payloads whose fields carry recommended-default PII category
// names at top-level (credential/token/bearer) and inside a nested
// object at path pii.email / pii.name / pii.address. Asserts the
// emitted line replaces the value with '[REDACTED:<category>]' on
// every match regardless of call-site.
//
// AC-15103-1 (recommended-default categories at top level) is
// observable and kept.
//
// AC-15103-4 requires the SPECIFIC shape `{ user: { id: "u-1",
// pii: { email: "a@b" } } }` with `user.id` PRESERVED and
// `user.pii.email` redacted. This probe uses a top-level `pii: {...}`
// object (no `user.` wrapper) and does not preserve a sibling id.
// Per closure-3 §(2) the three nested-path rows are de-claimed
// (anchorAcId=null, conformanceOnly true) with the limitation naming
// AC-15103-4. The observation (nested-path redaction fires under
// pii.email/pii.name/pii.address) is retained.
//
// AC-15103-3 (unrecognised category left unredacted) requires a
// specifically-shaped `custom.internal.token`-style field name. A
// bare `note` field does not exercise the "valid-but-unconfigured
// kebab/dotted grammar" the AC names. Per closure-3 §(2) that row
// is de-claimed with the limitation naming AC-15103-3.
//
// The AC-15103-4-shaped row IS observable and is added here (the
// preserved `user.id` sibling and redacted `user.pii.email` leaf).
//
// accountBound: false.
import { createLogger } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-observability-logging/src/logger-factory.mjs';

export const anchorAcId = 'AC-15103-1';
export const accountBound = false;
const AC1 = 'A log payload containing a field named or';
const AC4 = 'The redaction boundary reads a nested payload path:';
const AC4_LIM_NEST = `AC-15103-4 specifically requires the shape { user: { id: "u-1", pii: { email: "a@b" } } } with user.id PRESERVED and user.pii.email REDACTED. A top-level pii: {...} object with no user wrapper and no preserved sibling id does not exercise the AC's shape.`;
const AC3_LIM_NOTE = `AC-15103-3 requires a valid-but-unconfigured category name (kebab or dotted-namespace grammar), e.g. custom.internal.token, that looks like a redaction path but is not in defaults or additions. A bare field name 'note' with no category-shaped label does not exercise the AC's grammar constraint.`;

export default async function runProbe() {
  const outBuf = [];
  const log = createLogger({ environment: 'qa', serviceName: 'probe-svc', serviceVersion: '0.0.1', outSink: (s) => outBuf.push(s), errSink: () => {} });
  const payload = { credential: 'SAMPLE_CRED_VALUE', token: 'SAMPLE_TOKEN_VALUE', bearer: 'SAMPLE_BEARER_VALUE', pii: { email: 'sample@example.com', name: 'Sample Person', address: '1 Sample St' }, note: 'this stays' };
  log.info('with-pii', payload);
  const line1 = JSON.parse(outBuf.join('').split('\n').filter(Boolean)[0]);

  // AC-15103-4-shaped emission: { user: { id: 'u-1', pii: { email: 'a@b' } } }.
  outBuf.length = 0;
  const acShapedPayload = { user: { id: 'u-1', pii: { email: 'a@b' } } };
  log.info('ac-15103-4-shape', acShapedPayload);
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
      verdict: c.got === c.expected ? 'pass' : 'fail',
      detail: `${AC1}  -  top-level field '${c.path}' folded to '${c.got}'; expected '${c.expected}'; observed by emitting a recommended-default category value at top-level per AC-15103-1.`,
      evidence: { path: c.path, valueOnLine: c.got, line: { correlationId: line1.correlationId ?? null, level: line1.level, message: line1.message, [c.path]: c.got } },
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
    detail: `observed negative-control top-level field 'note'='${line1.note}' (no category tag at all — passes through unredacted).`,
    evidence: { note: line1.note, valueOnLine: line1.note, line: { correlationId: line1.correlationId ?? null, level: line1.level, message: line1.message, note: line1.note } },
  });

  // AC-15103-4 shape observation.
  const emailRedactedOk = acShapedLine.user?.pii?.email === '[REDACTED:pii.email]';
  const idPreservedOk = acShapedLine.user?.id === 'u-1';
  results.push({
    anchorAcId: 'AC-15103-4',
    verdict: emailRedactedOk && idPreservedOk ? 'pass' : 'fail',
    detail: `${AC4}  -  observed emitted line with payload { user: { id: 'u-1', pii: { email: 'a@b' } } }: user.id='${acShapedLine.user?.id}' (expect 'u-1' PRESERVED); user.pii.email='${acShapedLine.user?.pii?.email}' (expect '[REDACTED:pii.email]').`,
    evidence: { userIdOnLine: acShapedLine.user?.id, userPiiEmailOnLine: acShapedLine.user?.pii?.email, line: { correlationId: acShapedLine.correlationId ?? null, level: acShapedLine.level, message: acShapedLine.message, user: acShapedLine.user } },
  });

  return { results, extra: { envDeclared: ['RCF_FIXTURE_LOGGER_CORRELATION_HEADER'], excerpt: line1, acShapedExcerpt: acShapedLine } };
}
