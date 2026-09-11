// Correlation-id-flow probe for observability-logging.
//
// Positive-evidence shape: the probe VARIES its inputs (a distinct
// correlation-id supplied on an inbound HTTP request header per call)
// and observes the DERIVED outputs the fixture computes: the emitted
// log line's correlationId + a fixture-computed sequence + a hash the
// fixture calculates from the id and its own sequence. The response
// body carries the fixture-computed sequence and hash; the response
// header carries the id.
// The probe RECOMPUTES the hash locally (SHA-256(id + ":" + sequence)
// truncated to 16 hex chars) and asserts it equals the fixture's
// value. The fixture never publishes the id into a value the probe
// asserts against a copy of itself; the assertion is on the derived
// hash and the sequence's monotonic step, both of which the fixture
// computes from the varied input.
//
// AC-15102-1 has two clauses: (a) header present -> header value on
// every emitted log line for the request; (b) header absent -> the
// application mints a v4 UUID and the same value appears on every
// log line for the request. This probe exercises BOTH clauses.
//
// The nested no-context emission proves the ambient store falls back
// to correlationId=null when nothing set it, so the http-set path
// isn't a lucky coincidence with a module-level default.

import { createHash, randomUUID } from 'node:crypto';
import { createLogger, createLoggerHttp } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-observability-logging/src/logger-factory.mjs';

export const anchorAcId = 'AC-15102-1';
export const accountBound = false;
const AC1 = 'A request arriving with the elicited correlation header';
const AC3 = 'A log emission with no ambient correlation context';

const HEADER = 'X-Correlation-Id';
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
        bodyCorrelationId: body?.correlationId,
        bodyMintedFromAbsent: body?.mintedFromAbsent,
        status: res.status,
      });
    }
    const emittedLines = outBuf.join('').split('\n').filter(Boolean).map((l) => JSON.parse(l));

    for (let i = 0; i < inputIds.length; i++) {
      const supplied = inputIds[i];
      const o = observed[i];
      const line = emittedLines.find((l) => l.correlationId === supplied && l.sequence === o.bodySequence);
      const localHash = (typeof o.bodySequence === 'number') ? expectedHash(supplied, o.bodySequence) : null;
      const lineOk = Boolean(line) && line.hash === localHash;
      const bodyOk = o.status === 200 && typeof o.bodySequence === 'number' && o.bodyHash === localHash && o.bodyMintedFromAbsent === false;
      const headerOk = o.headerEcho === supplied;
      results.push({
        anchorAcId: 'AC-15102-1',
        verdict: lineOk && bodyOk && headerOk ? 'pass' : 'fail',
        detail: `${AC1}  -  observed supplied inbound '${HEADER}'='${supplied}' -> line.correlationId='${line?.correlationId}' sequence=${line?.sequence} line.hash='${line?.hash}' locallyRecomputedHash='${localHash}' body.sequence=${o.bodySequence} body.hash='${o.bodyHash}' header='${o.headerEcho}' mintedFromAbsent=${o.bodyMintedFromAbsent}; observes AC-15102-1 header-present clause via header echo and derived hash equality.`,
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

    // AC-15102-1 header-absent clause: send with no correlation header,
    // observe the fixture mints a v4 UUID and the same value appears on
    // the emitted log line.
    const absentRes = await fetch(`http://127.0.0.1:${port}/hello`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'no-header-body',
    });
    const absentBodyText = await absentRes.text();
    let absentBody = null; try { absentBody = JSON.parse(absentBodyText); } catch {}
    const mintedId = absentBody?.correlationId ?? '';
    const mintedIsV4 = UUID_V4_RE.test(mintedId);
    const echoedInHeader = absentRes.headers.get(HEADER.toLowerCase());
    const linesAfter = outBuf.join('').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const absentLine = linesAfter.find((l) => l.correlationId === mintedId && l.sequence === absentBody?.sequence);
    const absentOk = absentRes.status === 200
      && mintedIsV4
      && absentBody?.mintedFromAbsent === true
      && echoedInHeader === mintedId
      && Boolean(absentLine);
    results.push({
      anchorAcId: 'AC-15102-1',
      verdict: absentOk ? 'pass' : 'fail',
      detail: `${AC1}  -  observed inbound with NO '${HEADER}' header -> body.correlationId='${mintedId}' (v4?${mintedIsV4}) mintedFromAbsent=${absentBody?.mintedFromAbsent} header echo='${echoedInHeader}' log-line.correlationId='${absentLine?.correlationId}' sequence=${absentLine?.sequence}; observes AC-15102-1 header-absent clause via minted v4 UUID appearing on the emitted line.`,
      evidence: {
        // No header supplied on this request; the fixture mints a v4
        // UUID and echoes it verbatim on the response header, the
        // response body and the emitted log line. The minted id is
        // recorded as a request id (engine-minted lane) because it is
        // the engine's response identifier, not a probe-supplied
        // input; a bare `suppliedInput` sentinel would break the
        // identifier-pairing equality rule.
        requestId: mintedId,
        absentSuppliedInput: true,
        derivedLogLine: absentLine ? { message: absentLine.message, correlationId: absentLine.correlationId, path: absentLine.path, sequence: absentLine.sequence, hash: absentLine.hash } : null,
        derivedResponseHeader: echoedInHeader,
        derivedResponseBodySequence: absentBody?.sequence,
        derivedResponseBodyHash: absentBody?.hash,
        responseStatus: absentRes.status,
        mintedFromAbsent: absentBody?.mintedFromAbsent,
        mintedIsV4,
      },
    });

    const seqs = observed.map((o) => o.bodySequence);
    const monotonic = seqs.every((n, i) => typeof n === 'number' && (i === 0 || n === seqs[i - 1] + 1));
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: 'AC-15102-1: concerns the correlation ID travelling from the inbound header (or minted UUID) to every emitted log line during the request. Sequence monotonicity is anti-echo signalling that the fixture computes derived state; it is not the AC-15102-1 property.',
      verdict: monotonic ? 'pass' : 'fail',
      detail: `observed fixture per-server sequence as ${JSON.stringify(seqs)}; monotonic step of 1 (anti-echo signal that fixture computes derived state).`,
      evidence: { suppliedInputs: inputIds, derivedSequences: seqs, derivedResponseHeader: observed[0]?.headerEcho, suppliedInput: inputIds[0], bodyExcerpt: 'seq=' + JSON.stringify(seqs) },
    });

    outBuf.length = 0;
    logger.info('bare');
    const bare = JSON.parse(outBuf.join('').split('\n').filter(Boolean)[0]);
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: `AC-15102-3: the bare emission with no ambient correlation context is a single emitted log line whose only recorded value is the null correlationId itself. The row observes the property but carries no request or resource identifier the engine returned; identifier-plus-derived evidence is not available here (the strict-evidence contract tightening).`,
      verdict: bare.correlationId === null ? 'pass' : 'fail',
      detail: `${AC3}  -  observed bare emission (no runWithCorrelation) carries correlationId=${JSON.stringify(bare.correlationId)} (expected null per AC-15102-3); de-claimed to conformanceOnly per the strict-evidence contract because no engine-returned identifier is available for a bare emission.`,
      evidence: { bareLineCorrelationId: bare.correlationId, bodyExcerpt: JSON.stringify(bare).slice(0, 200) },
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
