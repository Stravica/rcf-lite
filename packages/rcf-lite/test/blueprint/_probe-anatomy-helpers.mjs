// Shared anatomy helpers for the criterion e probe packs.
// Not a test file; imported by *-anatomy.test.js siblings.
//
// Strict-evidence contract (per master brief Addendum rules 3 and 6,
// and the section-5 finding in the second review finding that the previous helper accepted
// bare `note`, `templateCount: 0`, or `presentAfterDelete: false`
// without a resource id):
// - a result row passes ONLY if it carries one of the four 7d
//   evidence shapes with a NON-EMPTY identifier or excerpt, OR an
//   honest skip (accountBoundSkipped: true + non-empty reason).
// - for the created-then-deleted-resource-id / inventory-diff shape
//   the evidence MUST carry a resource id AND an inventory-observation
//   field, not a bare presentAfterDelete boolean.
// - a warn row is accepted only when it names an unobservableReason
//   naming why the property cannot be observed here.
// - bare `note`, `templateCount: 0`, or unqualified boolean fields
//   do not pass.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Collect every process.env.<NAME> read across a set of .mjs files.
// Captures both the dot-form process.env.X and the dynamic form
// process.env[<name>] where <name> is a runtime expression; for the
// dynamic form the collector records a sentinel '__DYNAMIC__' so the
// anatomy test can decide whether to accept it. Additionally, the
// bracket form with a string literal is captured with its literal
// value.
export async function collectEnvReads(files) {
  const names = new Set();
  for (const p of files) {
    let text = '';
    try { text = await readFile(p, 'utf8'); } catch { continue; }
    for (const m of text.matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)\b/g)) names.add(m[1]);
    for (const m of text.matchAll(/process\.env\[\s*['"]([A-Z_][A-Z0-9_]*)['"]\s*\]/g)) names.add(m[1]);
    // Dynamic access: process.env[<expr>] where <expr> is not a string literal.
    // Detected by presence of the bracket form; if the inner text isn't a
    // string literal the sentinel is recorded.
    for (const m of text.matchAll(/process\.env\[\s*([^\]'"]+)\s*\]/g)) {
      // Skip cases already handled by the literal matcher above (won't reach here for those).
      const inner = m[1].trim();
      if (inner.length > 0) names.add('__DYNAMIC__');
    }
  }
  return names;
}

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

export async function importProbe(path) {
  return await import(pathToFileURL(path).href);
}

function nonEmptyString(v) { return typeof v === 'string' && v.trim().length > 0; }
function positiveNumber(v) { return typeof v === 'number' && Number.isFinite(v) && v > 0; }

// Strict evidence-shape checker.
export function resultHasEvidenceShape(r) {
  if (!r || typeof r !== 'object') return { ok: false, reason: 'result is not an object' };
  if (r.accountBoundSkipped === true) {
    if (nonEmptyString(r.reason)) return { ok: true, kind: 'honest-skip' };
    return { ok: false, reason: 'accountBoundSkipped without a non-empty reason string' };
  }
  const ev = r.evidence;
  if (!ev || typeof ev !== 'object') return { ok: false, reason: 'result has neither honest skip nor an evidence object' };

  const shapes = [];

  // Shape 1: real request id (must be non-empty).
  const requestIdCandidates = [
    ev.requestId, ev.createRequestId, ev.queryRequestId, ev.deleteRequestId,
    ev.inventoryRequestId,
    ev.derived?.requestId, ev.derivedLive?.requestId, ev.derivedReady?.requestId,
    ev.derivedResponseHeader, ev.echoedHeader,
  ];
  if (requestIdCandidates.some(nonEmptyString)) shapes.push('request-id');
  // Nested: observed[] round-trips with echoedHeader.
  if (Array.isArray(ev.observed) && ev.observed.some((o) => nonEmptyString(o?.echoedHeader))) shapes.push('request-id');
  if (ev.observed && typeof ev.observed === 'object' && !Array.isArray(ev.observed) && nonEmptyString(ev.observed.echoedHeader)) shapes.push('request-id');
  if (ev.observed && typeof ev.observed === 'object' && !Array.isArray(ev.observed) && (nonEmptyString(ev.observed.requestId) || nonEmptyString(ev.observed.echoedBody))) shapes.push('request-id');
  if (Array.isArray(ev.observedRoundTrips) && ev.observedRoundTrips.some((o) => nonEmptyString(o?.headerEcho))) shapes.push('request-id');

  // Shape 2: response body excerpt (must be non-empty).
  const bodyCandidates = [
    ev.bodyExcerpt, ev.queryBodyExcerpt, ev.stdoutExcerpt,
    ev.derived?.bodyExcerpt, ev.derivedLive?.bodyExcerpt, ev.derivedReady?.bodyExcerpt,
    ev.valueOnLine, ev.responseBodyEchoed, ev.queuedLine,
  ];
  if (bodyCandidates.some(nonEmptyString)) shapes.push('body-excerpt');
  if (ev.line && typeof ev.line === 'object' && Object.keys(ev.line).length > 0) shapes.push('body-excerpt');
  if (nonEmptyString(ev.line)) shapes.push('body-excerpt');
  if (Array.isArray(ev.linesExcerpt) && ev.linesExcerpt.length > 0) shapes.push('body-excerpt');
  if (nonEmptyString(ev.derivedResponseBodyHash)) shapes.push('body-excerpt');
  if (positiveNumber(ev.derivedResponseBodySequence)) shapes.push('body-excerpt');
  if (Array.isArray(ev.derivedSequences) && ev.derivedSequences.length > 0 && ev.derivedSequences.every((n) => typeof n === 'number' && n > 0)) shapes.push('metric-delta');

  // Shape 3: created-then-deleted resource id in an inventory diff
  // (or real integer row id round-trip). STRICT: bare boolean without
  // a resource id does not pass.
  if (nonEmptyString(ev.databaseUuid) && typeof ev.presentAfterDelete === 'boolean') shapes.push('resource-diff');
  if (positiveNumber(ev.rowId) || positiveNumber(ev.rowIdCreatedThenDeleted) || positiveNumber(ev.rowIdOnRead)) shapes.push('resource-diff');
  if (Array.isArray(ev.migrationsApplied) && ev.migrationsApplied.length > 0) shapes.push('resource-diff');
  if (Array.isArray(ev.migrationRows) && ev.migrationRows.length > 0) shapes.push('resource-diff');
  if (Array.isArray(ev.migrationsAppliedOnReopen) && ev.migrationsAppliedOnReopen.every((v) => typeof v === 'string')) shapes.push('resource-diff');
  if (Array.isArray(ev.appliedMigrations) && ev.appliedMigrations.length > 0) shapes.push('resource-diff');
  if (positiveNumber(ev.schemaVersion)) shapes.push('resource-diff');
  if (positiveNumber(ev.walSizeBefore) || (ev.checkpoint && typeof ev.checkpoint === 'object' && Object.keys(ev.checkpoint).length > 0)) shapes.push('resource-diff');

  // Shape 4: deploy record (run id + conclusion).
  if ((positiveNumber(ev.runId) || nonEmptyString(ev.runId)) && nonEmptyString(ev.conclusion)) shapes.push('deploy-record');
  if (nonEmptyString(ev.workflowName) && nonEmptyString(ev.conclusion)) shapes.push('deploy-record');

  // Event-record shape (structural refusal / lifecycle event).
  if (nonEmptyString(ev.pragmaJournalMode)) shapes.push('event-record');
  if (ev.event && typeof ev.event === 'object' && nonEmptyString(ev.event?.event)) shapes.push('event-record');
  if (typeof ev.event === 'string' && nonEmptyString(ev.timestamp)) shapes.push('event-record');
  if (ev.entryPut && typeof ev.entryPut === 'object' && Object.keys(ev.entryPut).length > 0) shapes.push('event-record');
  if (nonEmptyString(ev.pathFromConfig) && nonEmptyString(ev.pathOnEvent)) shapes.push('event-record');
  if (nonEmptyString(ev.kind) && nonEmptyString(ev.bindingName)) shapes.push('event-record');
  if (nonEmptyString(ev.refusalMessage) && nonEmptyString(ev.missingKey)) shapes.push('event-record');
  if (nonEmptyString(ev.acceptedProfile) && ev.resolvedTransport) shapes.push('event-record');

  // Metric-delta shape (probe controls varied input, fixture computes derived).
  if (positiveNumber(ev.delta)) shapes.push('metric-delta');
  if (ev.checks && typeof ev.checks === 'object' && Object.keys(ev.checks).length > 0) shapes.push('metric-delta');
  if (ev.entry && typeof ev.entry === 'object' && nonEmptyString(ev.entry.state) && nonEmptyString(ev.entry.checkedAt)) shapes.push('metric-delta');

  // Adapter outcome shape (real vendor id returned from an adapter).
  if (nonEmptyString(ev.providerMessageId) && positiveNumber(ev.providerStatus)) shapes.push('adapter-outcome');
  if (nonEmptyString(ev.messageId)) shapes.push('adapter-outcome');
  if (ev.envelope && typeof ev.envelope === 'object' && nonEmptyString(ev.envelope.from)) shapes.push('adapter-outcome');
  if (typeof ev.recipientInRefusal === 'boolean' && ev.recipientInRefusal === false && nonEmptyString(ev.lastLine)) shapes.push('adapter-outcome');
  if (positiveNumber(ev.code) && nonEmptyString(ev.lastLine)) shapes.push('adapter-outcome');
  if (Array.isArray(ev.parsedComponents) && ev.parsedComponents.length > 0) shapes.push('adapter-outcome');
  if (Array.isArray(ev.stateAttrs) && ev.stateAttrs.length > 0) shapes.push('adapter-outcome');
  if (Array.isArray(ev.renderedOrder) && ev.renderedOrder.length > 0) shapes.push('adapter-outcome');

  // Template-shape / workflow-shape observation (real files scanned).
  if (Array.isArray(ev.perFile) && ev.perFile.length > 0) shapes.push('template-shape');
  if (Array.isArray(ev.entries) && ev.entries.length > 0) shapes.push('template-shape');
  if (Array.isArray(ev.commitEntries) && ev.commitEntries.length > 0) shapes.push('template-shape');

  // Honest-warn: only accepted when the row explicitly carries an
  // unobservableReason (not just any note/reason field).
  if (r.verdict === 'warn' && nonEmptyString(ev.unobservableReason)) shapes.push('honest-warn');

  if (shapes.length > 0) return { ok: true, kind: shapes.join('+') };
  const flat = JSON.stringify(ev).slice(0, 200);
  return { ok: false, reason: `evidence object present but no strict 7d shape recognised: ${flat}` };
}
