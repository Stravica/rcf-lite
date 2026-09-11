// Correlation-id-flow probe for observability-logging v1.3.1.
// Binds a real request-scoped correlationId via runWithCorrelation
// and emits N lines; asserts every emitted line carries the same
// correlationId. A nested scope with a different id asserts scope
// isolation.
//
// Positive evidence: the UUIDv4 correlation ids minted at run time
// surface exactly on the emitted lines.
// anchorAcId: AC-15102-1. accountBound: false.

import { randomUUID } from 'node:crypto';
import { createLogger, runWithCorrelation } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-observability-logging/src/logger-factory.mjs';

export const anchorAcId = 'AC-15102-1';
export const accountBound = false;

export default async function runProbe() {
  const outBuf = [];
  const log = createLogger({ environment: 'qa', serviceName: 'probe-svc', serviceVersion: '0.0.1', outSink: (s) => outBuf.push(s), errSink: () => {} });
  const outerId = randomUUID();
  const innerId = randomUUID();
  const parsed = [];
  await runWithCorrelation(outerId, async () => {
    log.info('outer-1'); log.info('outer-2');
    await runWithCorrelation(innerId, async () => {
      log.info('inner-1'); log.info('inner-2');
    });
    log.info('outer-3');
  });
  for (const ln of outBuf.join('').split('\n').filter(Boolean)) parsed.push(JSON.parse(ln));
  const outerLines = parsed.filter((o) => o.message.startsWith('outer'));
  const innerLines = parsed.filter((o) => o.message.startsWith('inner'));
  const results = [];
  results.push({
    anchorAcId: 'AC-15102-1',
    verdict: outerLines.length === 3 && outerLines.every((o) => o.correlationId === outerId) ? 'pass' : 'fail',
    detail: `outer scope emitted ${outerLines.length} lines; all correlationId=${outerId}`,
    evidence: { outerId, outerLinesExcerpt: outerLines.map((o) => ({ message: o.message, correlationId: o.correlationId })) },
  });
  results.push({
    anchorAcId: 'AC-15102-2',
    verdict: innerLines.length === 2 && innerLines.every((o) => o.correlationId === innerId) ? 'pass' : 'fail',
    detail: `inner scope emitted ${innerLines.length} lines; all correlationId=${innerId}`,
    evidence: { innerId, innerLinesExcerpt: innerLines.map((o) => ({ message: o.message, correlationId: o.correlationId })) },
  });
  outBuf.length = 0;
  log.info('bare');
  const bare = JSON.parse(outBuf.join('').split('\n').filter(Boolean)[0]);
  results.push({
    anchorAcId: 'AC-15102-3',
    verdict: bare.correlationId === null ? 'pass' : 'fail',
    detail: `no-context emission carries correlationId=${JSON.stringify(bare.correlationId)}`,
    evidence: { line: bare },
  });
  return { results, extra: { envDeclared: ['RCF_FIXTURE_LOGGER_CORRELATION_HEADER'], outerId, innerId } };
}
