// Line-shape probe for observability-logging. Anchors AC-15101-1/3/4.
// Every detail line begins with the first eight words of the anchored AC text.
import { createLogger, LEVEL_ORDER } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-observability-logging/src/logger-factory.mjs';

export const anchorAcId = 'AC-15101-1';
export const accountBound = false;
const AC1 = 'A log emission at any level from any';
const AC3 = 'A log emission whose payload contains a BigInt';
const AC4 = 'The seven shared minimum fields (message, level, timestamp,';

export default async function runProbe() {
  const outBuf = []; const errBuf = [];
  const clock = () => '2026-09-11T12:00:00.000Z';
  const log = createLogger({ environment: 'qa', serviceName: 'probe-svc', serviceVersion: '0.0.1', minLevel: 'trace', outSink: (s) => outBuf.push(s), errSink: (s) => errBuf.push(s), clock });
  for (const lvl of LEVEL_ORDER) log[lvl](`hello-${lvl}`);
  const lines = outBuf.join('').split('\n').filter(Boolean);
  const required = ['message', 'level', 'timestamp', 'correlationId', 'environment', 'serviceName', 'serviceVersion'];
  const results = [];
  const parsed = [];
  let allOk = lines.length === LEVEL_ORDER.length;
  for (const ln of lines) {
    let obj = null; let ok = true;
    try { obj = JSON.parse(ln); } catch { ok = false; }
    parsed.push(obj);
    if (!ok || required.some((k) => !(k in (obj || {})))) allOk = false;
  }
  results.push({
    anchorAcId: 'AC-15101-1',
    verdict: allOk ? 'pass' : 'fail',
    detail: `${AC1} call site  -  observed ${lines.length} lines on stdout; each JSON.parses and carries the seven minimum fields; expected=${LEVEL_ORDER.length}.`,
    evidence: { linesExcerpt: lines.slice(0, 3), levelsSeen: parsed.filter(Boolean).map((o) => o.level) },
  });
  outBuf.length = 0; errBuf.length = 0;
  log.info('bigint', { id: 9007199254740993n });
  const bLines = outBuf.join('').split('\n').filter(Boolean);
  let bParsed = null;
  try { bParsed = JSON.parse(bLines[0]); } catch {}
  results.push({
    anchorAcId: 'AC-15101-3',
    verdict: bParsed && bParsed.id === '9007199254740993' && errBuf.join('').length === 0 ? 'pass' : 'fail',
    detail: `${AC3} value  -  observed BigInt folded to '${bParsed?.id}' on the emitted line; stderr='${errBuf.join('').trim()}'.`,
    evidence: { line: bLines[0] },
  });
  outBuf.length = 0; errBuf.length = 0;
  log.info('coll', { level: 'boom', timestamp: 'yesterday', custom: 'ok' });
  const cLine = outBuf.join('').split('\n').filter(Boolean)[0];
  let cParsed = null;
  try { cParsed = JSON.parse(cLine); } catch {}
  const errCombined = errBuf.join('');
  results.push({
    anchorAcId: 'AC-15101-4',
    verdict: cParsed?.level === 'info' && cParsed?.timestamp === '2026-09-11T12:00:00.000Z' && errCombined.includes("'level'") && errCombined.includes("'timestamp'") ? 'pass' : 'fail',
    detail: `${AC4} correlationId,  -  observed factory-authored level=${cParsed?.level} timestamp=${cParsed?.timestamp}; stderr excerpt='${errCombined.trim()}' names the reserved keys.`,
    evidence: { line: cLine, stderr: errCombined },
  });
  return { results, extra: { envDeclared: ['RCF_FIXTURE_LOGGER_CORRELATION_HEADER'], capturedStdoutBytes: outBuf.reduce((n, s) => n + s.length, 0) } };
}
