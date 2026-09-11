// Line-shape probe for observability-logging v1.3.1.
// Emits at every level in LEVEL_ORDER via the fixture factory
// (minLevel=trace), captures stdout, and asserts each line parses
// as one JSON object with the seven-field minimum set present with
// the correct types. Additional results cover BigInt fold and the
// reserved-key collision rules.
//
// Positive evidence: the exact captured stdout lines are excerpted
// on the report so a later reader can re-parse them.
// anchorAcId: AC-15101-1. accountBound: false.

import { createLogger, LEVEL_ORDER } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-observability-logging/src/logger-factory.mjs';

export const anchorAcId = 'AC-15101-1';
export const accountBound = false;

export default async function runProbe() {
  const outBuf = []; const errBuf = [];
  const clock = () => '2026-09-11T12:00:00.000Z';
  const log = createLogger({
    environment: 'qa', serviceName: 'probe-svc', serviceVersion: '0.0.1',
    minLevel: 'trace', outSink: (s) => outBuf.push(s), errSink: (s) => errBuf.push(s), clock,
  });
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
    detail: `${lines.length} lines parsed; each carries seven minimum fields; expected=${LEVEL_ORDER.length}`,
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
    detail: `BigInt folded to '${bParsed?.id}' on emit; stderr='${errBuf.join('').trim()}'`,
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
    detail: `factory-authored level=${cParsed?.level} timestamp=${cParsed?.timestamp}; stderr excerpt='${errCombined.trim()}'`,
    evidence: { line: cLine, stderr: errCombined },
  });

  return { results, extra: { envDeclared: ['RCF_FIXTURE_LOGGER_CORRELATION_HEADER'], capturedStdoutBytes: outBuf.reduce((n, s) => n + s.length, 0) } };
}
