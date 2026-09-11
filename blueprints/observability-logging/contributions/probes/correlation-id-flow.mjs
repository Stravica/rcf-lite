// Correlation-id-flow probe for observability-logging.
//
// Positive-evidence shape: the probe VARIES its inputs (a distinct
// correlation-id supplied on an inbound HTTP request header per
// call) and observes the DERIVED outputs the fixture computes: the
// emitted log line's correlationId field and the response's echoed
// header. The probe never authors the value being asserted against
// itself; the assertion is that the transport (fixture HTTP handler)
// propagated the inbound header into both surfaces.
//
// The nested no-context emission proves the ambient store falls back
// to correlationId=null when nothing set it, so the http-set path
// isn't a lucky coincidence with a module-level default.
//
// anchorAcId: AC-15102-1 (correlationId reflected on outbound
// requests + carried on emitted lines). accountBound: false.

import { randomUUID } from 'node:crypto';
import { createLogger, createLoggerHttp } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-observability-logging/src/logger-factory.mjs';

export const anchorAcId = 'AC-15102-1';
export const accountBound = false;

const HEADER = 'X-Correlation-Id';

export default async function runProbe() {
  const outBuf = [];
  const logger = createLogger({ environment: 'qa', serviceName: 'probe-svc', serviceVersion: '0.0.1', outSink: (s) => outBuf.push(s), errSink: () => {} });
  const http = createLoggerHttp({ headerName: HEADER.toLowerCase(), logger });
  const { port } = await http.listen(0);
  const results = [];
  // Vary the input: three distinct correlation ids on three requests.
  const inputIds = [randomUUID(), randomUUID(), randomUUID()];
  const observed = [];
  try {
    for (const inbound of inputIds) {
      const res = await fetch(`http://127.0.0.1:${port}/hello`, {
        method: 'POST',
        headers: { [HEADER]: inbound, 'content-type': 'text/plain' },
        body: 'body-' + inbound.slice(0, 4),
      });
      const bodyText = await res.text();
      observed.push({
        supplied: inbound,
        echoedHeader: res.headers.get(HEADER.toLowerCase()),
        responseBodyEchoed: (() => { try { return JSON.parse(bodyText).echoed; } catch { return null; } })(),
        status: res.status,
      });
    }
    const emittedLines = outBuf.join('').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    // For each supplied id, the fixture MUST have (a) emitted a log line
    // whose correlationId equals the supplied id, and (b) echoed the
    // header verbatim on the response.
    for (let i = 0; i < inputIds.length; i++) {
      const supplied = inputIds[i];
      const line = emittedLines.find((o) => o.correlationId === supplied);
      const o = observed[i];
      const derivedOk = Boolean(line)
        && o.status === 200
        && o.echoedHeader === supplied
        && o.responseBodyEchoed === supplied;
      results.push({
        anchorAcId: 'AC-15102-1',
        verdict: derivedOk ? 'pass' : 'fail',
        detail: `supplied inbound '${HEADER}'='${supplied}' -> line.correlationId='${line?.correlationId}', response header='${o.echoedHeader}', body.echoed='${o.responseBodyEchoed}'`,
        evidence: {
          suppliedInput: supplied,
          derivedLogLine: line ? { message: line.message, correlationId: line.correlationId, path: line.path } : null,
          derivedResponseHeader: o.echoedHeader,
          derivedResponseBody: o.responseBodyEchoed,
          responseStatus: o.status,
        },
      });
    }
    // Bare (no ambient context) emission observed on the same logger
    // to confirm the http-supplied ids weren't a module-level default.
    outBuf.length = 0;
    logger.info('bare');
    const bare = JSON.parse(outBuf.join('').split('\n').filter(Boolean)[0]);
    results.push({
      anchorAcId: 'AC-15102-3',
      verdict: bare.correlationId === null ? 'pass' : 'fail',
      detail: `bare emission (no runWithCorrelation) carries correlationId=${JSON.stringify(bare.correlationId)} (expected null)`,
      evidence: { line: bare },
    });
  } finally {
    await http.close();
  }
  return {
    results,
    extra: {
      envDeclared: ['RCF_FIXTURE_LOGGER_CORRELATION_HEADER'],
      headerName: HEADER,
      port,
      variedInputs: inputIds,
      observedRoundTrips: observed,
    },
  };
}
