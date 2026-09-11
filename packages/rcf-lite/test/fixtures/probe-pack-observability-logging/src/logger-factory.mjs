// Minimal logger factory fixture for observability-logging probes.
//
// Realises the blueprint's load-bearing shape: one JSON object per
// stdout line; seven-field minimum set (message, level, timestamp,
// correlationId, environment, serviceName, serviceVersion); ambient
// correlationId carried on every emitted line via runInContext;
// PII redaction at the boundary regardless of call-site (fields
// whose name or dotted path matches a redaction category are folded
// to '[REDACTED:<category>]' before serialisation); BigInt values
// folded to decimal strings per ADR-1605; reserved-name collisions
// dropped with one stderr notice per key.
//
// The factory is the sole writer to the injected outSink and errSink
// so probes can substitute string buffers for stdout / stderr and
// observe the resulting lines byte-for-byte.

import { AsyncLocalStorage } from 'node:async_hooks';

const store = new AsyncLocalStorage();

const RESERVED = new Set(['message', 'level', 'timestamp', 'correlationId', 'environment', 'serviceName', 'serviceVersion']);
const LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
const DEFAULT_REDACTION = new Set(['credential', 'pii.email', 'pii.name', 'pii.address', 'token', 'bearer']);

function shouldRedact(pathParts, redactionSet) {
  const last = pathParts[pathParts.length - 1];
  const dotted = pathParts.join('.');
  if (redactionSet.has(last)) return last;
  if (redactionSet.has(dotted)) return dotted;
  // dotted-namespace: pii.email matches a field named "email" under "pii" path
  for (const cat of redactionSet) {
    if (cat.includes('.')) {
      const parts = cat.split('.');
      if (parts.every((p, i) => pathParts[pathParts.length - parts.length + i] === p)) return cat;
    }
  }
  return null;
}

function foldValue(v, pathParts, redactionSet, notices) {
  if (v === null || v === undefined) return v;
  if (typeof v === 'bigint') return String(v);
  if (typeof v === 'function') {
    notices.push({ kind: 'unserialisable', path: pathParts.join('.'), reason: 'function' });
    return undefined;
  }
  if (typeof v === 'object') {
    if (Array.isArray(v)) return v.map((item, i) => foldValue(item, [...pathParts, String(i)], redactionSet, notices));
    const out = {};
    for (const [k, vv] of Object.entries(v)) {
      const cat = shouldRedact([...pathParts, k], redactionSet);
      if (cat) { out[k] = `[REDACTED:${cat}]`; continue; }
      const folded = foldValue(vv, [...pathParts, k], redactionSet, notices);
      if (folded !== undefined) out[k] = folded;
    }
    return out;
  }
  return v;
}

export function createLogger({ environment, serviceName, serviceVersion, minLevel = 'info', redactionCategories = [], outSink, errSink, clock } = {}) {
  if (!environment) throw new Error('boot-identity: environment required');
  if (!serviceName) throw new Error('boot-identity: serviceName required');
  if (!serviceVersion) throw new Error('boot-identity: serviceVersion required');
  const out = typeof outSink === 'function' ? outSink : (s) => process.stdout.write(s);
  const err = typeof errSink === 'function' ? errSink : (s) => process.stderr.write(s);
  const now = typeof clock === 'function' ? clock : () => new Date().toISOString();
  const minIdx = LEVELS.indexOf(minLevel);
  if (minIdx < 0) throw new Error(`boot-identity: minLevel unknown '${minLevel}'`);
  const redactionSet = new Set([...DEFAULT_REDACTION, ...redactionCategories]);

  function emit(level, message, payload) {
    const li = LEVELS.indexOf(level);
    if (li < minIdx) return;
    const correlationId = store.getStore()?.correlationId ?? null;
    const notices = [];
    const safeName = new Set();
    const clean = {};
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      for (const [k, v] of Object.entries(payload)) {
        if (RESERVED.has(k)) { safeName.add(k); continue; }
        const cat = shouldRedact([k], redactionSet);
        if (cat) { clean[k] = `[REDACTED:${cat}]`; continue; }
        const folded = foldValue(v, [k], redactionSet, notices);
        if (folded !== undefined) clean[k] = folded;
      }
    }
    for (const key of safeName) err(`reserved-key-collision: '${key}' from caller dropped\n`);
    for (const n of notices) err(`unserialisable: dropped '${n.path}' (${n.reason})\n`);
    const line = {
      message: String(message),
      level,
      timestamp: now(),
      correlationId,
      environment,
      serviceName,
      serviceVersion,
      ...clean,
    };
    try {
      out(JSON.stringify(line) + '\n');
    } catch (e) {
      err(`serialise-failed: ${e.message}\n`);
    }
  }

  return {
    trace: (m, p) => emit('trace', m, p),
    debug: (m, p) => emit('debug', m, p),
    info: (m, p) => emit('info', m, p),
    warn: (m, p) => emit('warn', m, p),
    error: (m, p) => emit('error', m, p),
    fatal: (m, p) => emit('fatal', m, p),
  };
}

export function runWithCorrelation(correlationId, fn) {
  return store.run({ correlationId }, fn);
}

export const RESERVED_KEYS = RESERVED;
export const LEVEL_ORDER = LEVELS;
