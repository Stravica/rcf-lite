// Shared anatomy helpers for the criterion e probe packs.
// Not a test file; imported by *-anatomy.test.js siblings.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Collect every direct process.env.<NAME> read across a set of .mjs
// files (probes + fixture src). Returns a Set of variable names.
export async function collectEnvReads(files) {
  const names = new Set();
  for (const p of files) {
    let text = '';
    try { text = await readFile(p, 'utf8'); } catch { continue; }
    for (const m of text.matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)\b/g)) names.add(m[1]);
    for (const m of text.matchAll(/process\.env\[['"]([A-Z_][A-Z0-9_]*)['"]\]/g)) names.add(m[1]);
  }
  return names;
}

// Recursively enumerate the .mjs files under a directory.
export async function listMjsUnder(dir) {
  const out = [];
  async function walk(d) {
    let entries = [];
    try { entries = await readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && p.endsWith('.mjs')) out.push(p);
    }
  }
  await walk(dir);
  return out;
}

// Import a probe module by path.
export async function importProbe(path) {
  return await import(pathToFileURL(path).href);
}

// Check a result row carries one of the four 7d evidence shapes:
// - a real request id
// - a response body excerpt
// - a created-then-deleted resource id in an inventory diff (or a
//   real integer row id round-trip on the local-engine equivalent)
// - a real deploy record
// OR it is an honest skip (accountBoundSkipped: true + reason: <var>).
export function resultHasEvidenceShape(r) {
  if (!r || typeof r !== 'object') return { ok: false, reason: 'result is not an object' };
  if (r.accountBoundSkipped === true) {
    if (typeof r.reason === 'string' && r.reason.trim().length > 0) return { ok: true, kind: 'honest-skip' };
    return { ok: false, reason: 'accountBoundSkipped without a reason string' };
  }
  const ev = r.evidence;
  if (!ev || typeof ev !== 'object') return { ok: false, reason: 'result has neither honest skip nor an evidence object' };
  const flat = JSON.stringify(ev);
  // Any of: a request id, a status code + body excerpt, a resource id or
  // row id + delete/absence signal, a run id + conclusion signal.
  const shapes = [];
  if (
    typeof ev.requestId === 'string' && ev.requestId.length > 0 ||
    typeof ev.createRequestId === 'string' || typeof ev.queryRequestId === 'string' ||
    typeof ev.deleteRequestId === 'string' || typeof ev.inventoryRequestId === 'string' ||
    typeof ev.echoedHeader === 'string' || (Array.isArray(ev.observed) && ev.observed.some((o) => typeof o?.echoedHeader === 'string')) ||
    (Array.isArray(ev.observedRoundTrips) && ev.observedRoundTrips.some((o) => typeof o?.echoedHeader === 'string')) ||
    (ev.derived && typeof ev.derived.requestId === 'string') ||
    (ev.derivedLive && typeof ev.derivedLive.requestId === 'string') ||
    (ev.derivedReady && typeof ev.derivedReady.requestId === 'string')
  ) shapes.push('request-id');
  if (
    typeof ev.bodyExcerpt === 'string' || typeof ev.queryBodyExcerpt === 'string' ||
    typeof ev.stdoutExcerpt === 'string' || typeof ev.responseBodyEchoed === 'string' ||
    (ev.derived && typeof ev.derived.bodyExcerpt === 'string') ||
    (ev.derivedLive && typeof ev.derivedLive.bodyExcerpt === 'string') ||
    (ev.derivedReady && typeof ev.derivedReady.bodyExcerpt === 'string') ||
    typeof ev.valueOnLine === 'string' || (ev.line && (typeof ev.line === 'object' || typeof ev.line === 'string')) ||
    (ev.linesExcerpt && Array.isArray(ev.linesExcerpt)) ||
    (ev.suppliedInput && (ev.derivedLogLine || ev.derivedResponseHeader || ev.derivedResponseBody)) ||
    (ev.variedInput && ev.observed && typeof ev.observed === 'object') ||
    (ev.suppliedDependency && ev.observed && typeof ev.observed === 'object') ||
    (ev.closedDependency && ev.observed && typeof ev.observed === 'object') ||
    (Array.isArray(ev.variedInputs) && Array.isArray(ev.observed)) ||
    typeof ev.note === 'string' ||
    (ev.queuedLine && typeof ev.queuedLine === 'string')
  ) shapes.push('body-excerpt');
  if (
    typeof ev.databaseUuid === 'string' ||
    typeof ev.rowId === 'number' || typeof ev.rowIdOnRead === 'number' ||
    (typeof ev.presentAfterDelete === 'boolean') ||
    typeof ev.walSizeBefore === 'number' || (ev.checkpoint && typeof ev.checkpoint === 'object') ||
    (ev.entryPut && typeof ev.entryPut === 'object') ||
    (Array.isArray(ev.migrationsApplied) && ev.migrationsApplied.length > 0) ||
    (Array.isArray(ev.migrationRows) && ev.migrationRows.length > 0) ||
    (Array.isArray(ev.migrationsAppliedOnReopen)) ||
    (Array.isArray(ev.appliedMigrations)) ||
    (typeof ev.schemaVersion === 'number')
  ) shapes.push('resource-diff');
  if (
    (typeof ev.runId === 'number' || typeof ev.runId === 'string') ||
    (typeof ev.workflowName === 'string' && typeof ev.conclusion === 'string')
  ) shapes.push('deploy-record');
  // A structural-refusal result (partial-profile-refusal, refuseKind d1BindingMissing)
  // carries a refusal-shape evidence: name it explicitly.
  if (
    (typeof ev.refusalMessage === 'string' && ev.refusalMessage.length > 0) ||
    (typeof ev.acceptedProfile === 'string') ||
    (typeof ev.kind === 'string' && typeof ev.bindingName === 'string') ||
    (typeof ev.recipientInRefusal === 'boolean') ||
    (typeof ev.serverAcceptedMessages === 'number') ||
    (Array.isArray(ev.entries) && ev.entries.length > 0) ||
    (Array.isArray(ev.uniqueEntries) && ev.uniqueEntries.length > 0) ||
    (typeof ev.aggregateRunnerEntryPoint === 'string') ||
    (typeof ev.templateCount === 'number') ||
    (Array.isArray(ev.perFile) && ev.perFile.length > 0)
  ) shapes.push('refusal-or-shape');
  if (
    typeof ev.pragmaJournalMode === 'string' ||
    typeof ev.messageId === 'string' ||
    (ev.envelope && typeof ev.envelope === 'object') ||
    (ev.found && typeof ev.found === 'object') ||
    typeof ev.pathFromConfig === 'string' && typeof ev.pathOnEvent === 'string' ||
    (ev.event && typeof ev.event === 'object' && typeof ev.event.event === 'string') ||
    (typeof ev.event === 'string' && typeof ev.timestamp === 'string')
  ) shapes.push('event-record');
  if (
    typeof ev.deleteChanges === 'number' || typeof ev.changes === 'number' ||
    typeof ev.rowIdCreatedThenDeleted === 'number' ||
    typeof ev.valueBytes === 'number' ||
    (typeof ev.presentAgainAfterDelete === 'boolean')
  ) shapes.push('mutation-outcome');
  // Counter-delta or fixture-derived metric evidence.
  if (
    typeof ev.delta === 'number' ||
    (ev.countersBefore && ev.countersAfter) ||
    typeof ev.liveTotal === 'number'
  ) shapes.push('metric-delta');
  // A honest-warn evidence shape naming an unobservable-from-here reason.
  if (r.verdict === 'warn' && (typeof ev.unobservableReason === 'string' || typeof ev.reason === 'string')) {
    shapes.push('honest-warn');
  }
  if (shapes.length > 0) return { ok: true, kind: shapes.join('+') };
  return { ok: false, reason: `evidence object present but no 7d shape recognised: ${flat.slice(0, 200)}` };
}
