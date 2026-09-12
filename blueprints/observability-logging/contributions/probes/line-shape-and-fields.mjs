// Line-shape probe for observability-logging.
// Anchors AC-15101-1 (with the row extended to type-check each of the
// shared minimum fields, so a numeric or object value cannot pass a
// presence-only check), AC-15101-3 (BigInt-safe folding) and
// AC-15101-4 (reserved-key collision safety).
import { randomUUID } from 'node:crypto';
import { createLogger, LEVEL_ORDER, runWithCorrelation } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-observability-logging/src/logger-factory.mjs';

export const anchorAcId = 'AC-15101-1';
export const accountBound = false;
const AC1 = 'A log emission at any level from any';
const AC3 = 'A log emission whose payload contains a BigInt';
const AC4 = 'The seven shared minimum fields (message, level, timestamp,';

export default async function runProbe() {
  const outBuf = []; const errBuf = [];
  const clock = () => '2026-09-11T12:00:00.000Z';
  const log = createLogger({ environment: 'qa', serviceName: 'probe-svc', serviceVersion: '0.0.1', minLevel: 'trace', outSink: (s) => outBuf.push(s), errSink: (s) => errBuf.push(s), clock });
  const perLevelIds = [];
  for (const lvl of LEVEL_ORDER) {
    const cid = randomUUID();
    perLevelIds.push({ level: lvl, correlationId: cid });
    runWithCorrelation(cid, () => log[lvl](`hello-${lvl}`));
  }
  const lines = outBuf.join('').split('\n').filter(Boolean);
  const required = ['message', 'level', 'timestamp', 'correlationId', 'environment', 'serviceName', 'serviceVersion'];
  const results = [];
  const parsed = [];
  let allOk = lines.length === LEVEL_ORDER.length;
  let typeFailures = [];
  for (const ln of lines) {
    let obj = null; let ok = true;
    try { obj = JSON.parse(ln); } catch { ok = false; }
    parsed.push(obj);
    if (!ok) { allOk = false; continue; }
    for (const k of required) {
      if (!(k in obj)) { allOk = false; typeFailures.push({ key: k, reason: 'missing' }); continue; }
      // correlationId is explicitly nullable when the emission has no
      // ambient correlation context (AC-15102-3). Every other field
      // must be a non-empty string.
      if (k === 'correlationId') {
        if (obj[k] !== null && (typeof obj[k] !== 'string' || obj[k].length === 0)) { allOk = false; typeFailures.push({ key: k, reason: `correlationId must be null or non-empty string (got ${typeof obj[k]})` }); }
      } else if (typeof obj[k] !== 'string' || obj[k].length === 0) {
        allOk = false; typeFailures.push({ key: k, reason: `not-non-empty-string (got ${typeof obj[k]})` });
      }
    }
    // timestamp additionally must ISO-8601 parse.
    if (typeof obj.timestamp === 'string' && Number.isNaN(Date.parse(obj.timestamp))) { allOk = false; typeFailures.push({ key: 'timestamp', reason: 'not ISO-8601 parseable' }); }
  }
  results.push({
    anchorAcId: 'AC-15101-1',
    verdict: allOk ? 'pass' : 'fail',
    detail: `${AC1} call site  -  observed ${lines.length} lines on stdout; each JSON.parses and carries the seven minimum fields as non-empty strings (timestamp parses ISO-8601); expected=${LEVEL_ORDER.length}; typeFailures=${JSON.stringify(typeFailures)}.`,
    evidence: { linesExcerpt: lines.slice(0, 3), levelsSeen: parsed.filter(Boolean).map((o) => o.level), typeFailures, observedEmissions: perLevelIds, suppliedInput: perLevelIds[0]?.correlationId, line: parsed[0] },
  });
  outBuf.length = 0; errBuf.length = 0;
  const bigCid = randomUUID();
  runWithCorrelation(bigCid, () => log.info('bigint', { id: 9007199254740993n }));
  const bLines = outBuf.join('').split('\n').filter(Boolean);
  let bParsed = null;
  try { bParsed = JSON.parse(bLines[0]); } catch {}
  results.push({
    anchorAcId: 'AC-15101-3',
    verdict: bParsed && bParsed.id === '9007199254740993' && errBuf.join('').length === 0 ? 'pass' : 'fail',
    detail: `${AC3} value  -  observed BigInt folded to '${bParsed?.id}' on the emitted line; stderr='${errBuf.join('').trim()}'.`,
    evidence: { line: bParsed, bodyExcerpt: bLines[0], suppliedInput: bigCid },
  });
  outBuf.length = 0; errBuf.length = 0;
  const collCid = randomUUID();
  runWithCorrelation(collCid, () => log.info('coll', { level: 'boom', timestamp: 'yesterday', custom: 'ok' }));
  const cLine = outBuf.join('').split('\n').filter(Boolean)[0];
  let cParsed = null;
  try { cParsed = JSON.parse(cLine); } catch {}
  const errCombined = errBuf.join('');
  results.push({
    anchorAcId: 'AC-15101-4',
    verdict: cParsed?.level === 'info' && cParsed?.timestamp === '2026-09-11T12:00:00.000Z' && errCombined.includes("'level'") && errCombined.includes("'timestamp'") ? 'pass' : 'fail',
    detail: `${AC4} correlationId,  -  observed factory-authored level=${cParsed?.level} timestamp=${cParsed?.timestamp}; stderr excerpt='${errCombined.trim()}' names the reserved keys.`,
    evidence: { line: cParsed, bodyExcerpt: cLine, stderr: errCombined, suppliedInput: collCid },
  });
  return { results, extra: { envDeclared: ['RCF_FIXTURE_LOGGER_CORRELATION_HEADER'], capturedStdoutBytes: outBuf.reduce((n, s) => n + s.length, 0) } };
}
