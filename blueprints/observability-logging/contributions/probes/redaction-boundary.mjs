// Redaction-boundary probe for observability-logging.
//
// Emits one payload per recommended-default category (credential,
// token, bearer, pii.email, pii.name, pii.address) inside its own
// runWithCorrelation(randomUUID(), ...) so each emission carries a
// real, per-emission correlation id. For each category the probe
// records the supplied correlation id, the emitted line's correlation
// id (proving pairing on the wire), the redacted field value and the
// caller-payload-unmutated observation - anchoring AC-15103-1 for
// every one of the six mandatory categories the AC names.
//
// AC-15103-4 requires the SPECIFIC shape `{ user: { id: "u-1",
// pii: { email: "a@b" } } }` with `user.id` PRESERVED and
// `user.pii.email` redacted. That emission is a separate row anchored
// on AC-15103-4, again with a per-emission correlation id paired to
// the emitted line.
//
// AC-15103-3 (unrecognised category left unredacted) requires a
// specifically-shaped `custom.internal.token`-style field name. A
// bare `note` field does not exercise the "valid-but-unconfigured
// kebab/dotted grammar" the AC names. Row de-claimed with the
// limitation naming AC-15103-3.
import { randomUUID } from 'node:crypto';
import { createLogger, runWithCorrelation } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-observability-logging/src/logger-factory.mjs';

export const anchorAcId = 'AC-15103-1';
export const accountBound = false;
const AC1 = 'A log payload containing a field named or';
const AC4 = 'The redaction boundary reads a nested payload path:';
const AC3_LIM_NOTE = `AC-15103-3: requires a valid-but-unconfigured category name (kebab or dotted-namespace grammar), e.g. custom.internal.token, that looks like a redaction path but is not in defaults or additions. A bare field name 'note' with no category-shaped label does not exercise the AC's grammar constraint.`;

function deepClone(v) { return JSON.parse(JSON.stringify(v)); }
function sameShape(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

const CATEGORIES = [
  { path: 'credential', build: () => ({ credential: 'SAMPLE_CRED_VALUE' }), read: (l) => l.credential, expected: '[REDACTED:credential]' },
  { path: 'token', build: () => ({ token: 'SAMPLE_TOKEN_VALUE' }), read: (l) => l.token, expected: '[REDACTED:token]' },
  { path: 'bearer', build: () => ({ bearer: 'SAMPLE_BEARER_VALUE' }), read: (l) => l.bearer, expected: '[REDACTED:bearer]' },
  { path: 'pii.email', build: () => ({ pii: { email: 'sample@example.com' } }), read: (l) => l.pii?.email, expected: '[REDACTED:pii.email]' },
  { path: 'pii.name', build: () => ({ pii: { name: 'Sample Person' } }), read: (l) => l.pii?.name, expected: '[REDACTED:pii.name]' },
  { path: 'pii.address', build: () => ({ pii: { address: '1 Sample St' } }), read: (l) => l.pii?.address, expected: '[REDACTED:pii.address]' },
];

export default async function runProbe() {
  const outBuf = [];
  const log = createLogger({ environment: 'qa', serviceName: 'probe-svc', serviceVersion: '0.0.1', outSink: (s) => outBuf.push(s), errSink: () => {} });
  const results = [];
  const emittedCategoryLines = [];

  for (const cat of CATEGORIES) {
    outBuf.length = 0;
    const payload = cat.build();
    const beforePayload = deepClone(payload);
    const supplied = randomUUID();
    await runWithCorrelation(supplied, async () => { log.info(`redact-${cat.path}`, payload); });
    const emitted = JSON.parse(outBuf.join('').split('\n').filter(Boolean)[0]);
    emittedCategoryLines.push({ path: cat.path, supplied, emitted });
    const got = cat.read(emitted);
    const payloadUnmutated = sameShape(payload, beforePayload);
    const paired = emitted.correlationId === supplied;
    results.push({
      anchorAcId: 'AC-15103-1',
      verdict: got === cat.expected && payloadUnmutated && paired ? 'pass' : 'fail',
      detail: `${AC1}  -  category '${cat.path}': supplied correlationId='${supplied}' -> emitted line.correlationId='${emitted.correlationId}' (paired=${paired}); field value on line='${got}' (expect '${cat.expected}'); caller payload unmutated=${payloadUnmutated}. Observes both AC-15103-1 clauses (redacted output AND caller object not mutated) for this category.`,
      evidence: {
        path: cat.path,
        suppliedInput: supplied,
        derivedResponseHeader: emitted.correlationId,
        valueOnLine: got,
        payloadUnmutated,
        line: { correlationId: emitted.correlationId, level: emitted.level, message: emitted.message },
        bodyExcerpt: JSON.stringify(emitted).slice(0, 300),
      },
    });
  }

  // AC-15103-3 negative-control: a plain 'note' field with no category
  // grammar passes through unredacted. Emitted in its own correlation
  // context but only observed against AC-15103-3 (which requires the
  // dotted-namespace grammar this row does not exercise) so it stays
  // de-claimed to conformanceOnly.
  outBuf.length = 0;
  const notePayload = { note: 'this stays' };
  const noteSupplied = randomUUID();
  await runWithCorrelation(noteSupplied, async () => { log.info('note-passthrough', notePayload); });
  const noteLine = JSON.parse(outBuf.join('').split('\n').filter(Boolean)[0]);
  results.push({
    anchorAcId: null,
    conformanceOnly: true,
    limitation: AC3_LIM_NOTE,
    verdict: noteLine.note === 'this stays' && noteLine.correlationId === noteSupplied ? 'pass' : 'fail',
    detail: `observed negative-control top-level field 'note'='${noteLine.note}' (no category tag at all -- passes through unredacted); supplied correlationId='${noteSupplied}' -> emitted line.correlationId='${noteLine.correlationId}'.`,
    evidence: { note: noteLine.note, valueOnLine: noteLine.note, line: { correlationId: noteLine.correlationId, level: noteLine.level, message: noteLine.message, note: noteLine.note } },
  });

  // AC-15103-4-shaped emission: { user: { id: 'u-1', pii: { email: 'a@b' } } }.
  outBuf.length = 0;
  const acShapedPayload = { user: { id: 'u-1', pii: { email: 'a@b' } } };
  const acShapedBefore = deepClone(acShapedPayload);
  const acShapedSupplied = randomUUID();
  await runWithCorrelation(acShapedSupplied, async () => { log.info('ac-15103-4-shape', acShapedPayload); });
  const acShapedUnmutated = sameShape(acShapedPayload, acShapedBefore);
  const acShapedLine = JSON.parse(outBuf.join('').split('\n').filter(Boolean)[0]);
  const emailRedactedOk = acShapedLine.user?.pii?.email === '[REDACTED:pii.email]';
  const idPreservedOk = acShapedLine.user?.id === 'u-1';
  const acShapedPaired = acShapedLine.correlationId === acShapedSupplied;
  results.push({
    anchorAcId: 'AC-15103-4',
    verdict: emailRedactedOk && idPreservedOk && acShapedUnmutated && acShapedPaired ? 'pass' : 'fail',
    detail: `${AC4}  -  observed emitted line with payload { user: { id: 'u-1', pii: { email: 'a@b' } } }: user.id='${acShapedLine.user?.id}' (expect 'u-1' PRESERVED); user.pii.email='${acShapedLine.user?.pii?.email}' (expect '[REDACTED:pii.email]'); acShapedPayload unmutated=${acShapedUnmutated}; supplied correlationId='${acShapedSupplied}' -> emitted line.correlationId='${acShapedLine.correlationId}' (paired=${acShapedPaired}).`,
    evidence: {
      suppliedInput: acShapedSupplied,
      derivedResponseHeader: acShapedLine.correlationId,
      userIdOnLine: acShapedLine.user?.id,
      userPiiEmailOnLine: acShapedLine.user?.pii?.email,
      acShapedUnmutated,
      line: { correlationId: acShapedLine.correlationId, level: acShapedLine.level, message: acShapedLine.message, user: acShapedLine.user },
    },
  });

  return {
    results,
    extra: {
      envDeclared: ['RCF_FIXTURE_LOGGER_CORRELATION_HEADER'],
      categoriesObserved: emittedCategoryLines.map((c) => ({ path: c.path, supplied: c.supplied, emittedCorrelationId: c.emitted.correlationId, valueOnLine: c.path.includes('.') ? c.emitted.pii?.[c.path.split('.')[1]] : c.emitted[c.path] })),
      acShapedExcerpt: acShapedLine,
      acShapedUnmutated,
    },
  };
}
