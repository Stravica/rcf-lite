// Correlation-id-flow probe for observability-logging.
//
// Positive-evidence shape: the probe VARIES its inputs (a distinct
// correlation-id supplied on an inbound HTTP request header per
// call) and observes the DERIVED outputs the fixture computes: the
// emitted log line's correlationId + a fixture-computed sequence +
// a hash the fixture calculates from the id and its own sequence.
// The response body carries the fixture-computed sequence and hash;
// the response header carries the id.
// The probe RECOMPUTES the hash locally (SHA-256(id + ":" + sequence)
// truncated to 16 hex chars) and asserts it equals the fixture's
// value. The fixture never publishes the id into a value the probe
// asserts against a copy of itself; the assertion is on the derived
// hash and the sequence's monotonic step, both of which the fixture
// computes from the varied input.
//
// The nested no-context emission proves the ambient store falls back
// to correlationId=null when nothing set it, so the http-set path
// isn't a lucky coincidence with a module-level default.
//
// anchorAcId: AC-15102-1 (correlationId carried on emitted log line
// when a header value is present). accountBound: false.

import { createHash, randomUUID } from 'node:crypto';
import { createLogger, createLoggerHttp } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-observability-logging/src/logger-factory.mjs';

export const anchorAcId = 'AC-15102-1';
export const accountBound = false;
const AC1 = 'A request arriving with the elicited correlation header';
const AC3 = 'A log emission with no ambient correlation context';

const HEADER = 'X-Correlation-Id';

function expectedHash(id, sequence) {
  return createHash('sha256').update(`${id}:${sequence}`).digest('hex').slice(0, 16);
}

export default async function runProbe() {
  const outBuf = [];
  const logger = createLogger({ environment: 'qa', serviceName: 'probe-svc', serviceVersion: '0.0.1', outSink: (s) => outBuf.push(s), errSink: () => {} });
  const http = createLoggerHttp({ headerName: HEADER.toLowerCase(), logger });
  const { port } = await http.listen(0);
  const results = [];
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
      let body = null; try { body = JSON.parse(bodyText); } catch {}
      observed.push({
        supplied: inbound,
        headerEcho: res.headers.get(HEADER.toLowerCase()),
        bodySequence: body?.sequence,
        bodyHash: body?.hash,
        status: res.status,
      });
    }
    const emittedLines = outBuf.join('').split('\n').filter(Boolean).map((l) => JSON.parse(l));

    for (let i = 0; i < inputIds.length; i++) {
      const supplied = inputIds[i];
      const o = observed[i];
      // Find the log line whose correlationId equals the supplied id
      // AND whose fixture-computed sequence equals the body's.
      const line = emittedLines.find((l) => l.correlationId === supplied && l.sequence === o.bodySequence);
      const localHash = (typeof o.bodySequence === 'number') ? expectedHash(supplied, o.bodySequence) : null;
      const lineOk = Boolean(line) && line.hash === localHash;
      const bodyOk = o.status === 200 && typeof o.bodySequence === 'number' && o.bodyHash === localHash;
      const headerOk = o.headerEcho === supplied;
      results.push({
        anchorAcId: 'AC-15102-1',
        verdict: lineOk && bodyOk && headerOk ? 'pass' : 'fail',
        detail: `${AC1}  -  observed supplied inbound '${HEADER}'='${supplied}' -> line.correlationId='${line?.correlationId}' sequence=${line?.sequence} line.hash='${line?.hash}' locallyRecomputedHash='${localHash}' body.sequence=${o.bodySequence} body.hash='${o.bodyHash}' header='${o.headerEcho}'; observed by fetching the fixture route and recomputing SHA-256(id+":"+sequence) from the body's sequence, asserting the fixture's hash equals the local recomputation for AC-15102-1's "correlationId carried on every log line" property.`,
        evidence: {
          suppliedInput: supplied,
          derivedLogLine: line ? { message: line.message, correlationId: line.correlationId, path: line.path, sequence: line.sequence, hash: line.hash } : null,
          derivedResponseHeader: o.headerEcho,
          derivedResponseBodySequence: o.bodySequence,
          derivedResponseBodyHash: o.bodyHash,
          locallyRecomputedHash: localHash,
          responseStatus: o.status,
        },
      });
    }
    // Monotonic-sequence assertion  -  a derived output that can only
    // be right if the fixture is really computing per-request state.
    const seqs = observed.map((o) => o.bodySequence);
    const monotonic = seqs.every((n, i) => typeof n === 'number' && (i === 0 || n === seqs[i - 1] + 1));
    results.push({
      anchorAcId: 'AC-15102-1',
      verdict: monotonic ? 'pass' : 'fail',
      detail: `${AC1}  -  observed fixture per-server sequence as ${JSON.stringify(seqs)}; monotonic step of 1 asserts the fixture computed sequence per-request rather than echoing a shared constant.`,
      evidence: { suppliedInputs: inputIds, derivedSequences: seqs, derivedResponseHeader: observed.map((o) => o.headerEcho) },
    });

    // Bare (no ambient context) emission observed on the same logger
    // to confirm the http-supplied ids weren't a module-level default.
    outBuf.length = 0;
    logger.info('bare');
    const bare = JSON.parse(outBuf.join('').split('\n').filter(Boolean)[0]);
    results.push({
      anchorAcId: 'AC-15102-3',
      verdict: bare.correlationId === null ? 'pass' : 'fail',
      detail: `${AC3}  -  observed bare emission (no runWithCorrelation) carries correlationId=${JSON.stringify(bare.correlationId)} (expected null per AC-15102-3)`,
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
