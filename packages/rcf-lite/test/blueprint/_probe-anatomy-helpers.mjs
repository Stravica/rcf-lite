// Shared anatomy helpers for the criterion e probe packs.
// Not a test file; imported by *-anatomy.test.js siblings.
//
// Strict-evidence contract. A result row passes only when one of the
// following shapes holds:
//
//   1. accountBoundSkipped:true with a non-empty `reason` naming
//      exactly one declared unset env variable (enforced by each
//      anatomy test against DECLARED_ENV; per-variable one row).
//   2. notObservableHere:{ac, reason} with a non-empty reason and
//      an `ac` matching a real shipped AC id shape (AC-NNNN-N) AND
//      the AC id is in the caller-supplied browserOnlyAcIds set
//      (process-level properties are never notObservableHere; they
//      must use conformanceOnly instead).
//   3. conformanceOnly:true with anchorAcId=null AND a non-empty
//      `limitation` that names a real shipped AC id (AC-NNNN-N)
//      AND the named AC id exists in the caller-supplied
//      shippedAcIds set (only the applicable blueprint's ACs).
//   4. an evidence object carrying BOTH (a) a non-empty strong
//      identifier (request id / echoed header / resource id /
//      row id / message id / run id / correlation id / echoed
//      supplied input), AND (b) a non-empty derived value / body
//      excerpt / hash / migration list / template list / adapter
//      outcome / event record / pragma value / metric delta.
//
// the strict-evidence contract tightening (identifier half):
//   - Parsed log objects, log-line arrays, an object log line whose
//     only signal is a `message`, `linesExcerpt`, parsed component
//     lists, rendered-state or -order lists, `perFile`, `entries`
//     and `commitEntries` are DERIVED content, never identifiers.
//   - A row-authored `callTrackingId` (locally invented) is not a
//     resource identifier and does not satisfy the identifier half.
//   - The honest-warn shape (WARN carrying only
//     `evidence.unobservableReason`) is refused: a WARN row must
//     still satisfy exact-skip, notObservableHere (browser-only) or
//     identifier-plus-derived.
//   - When `shippedAcIds` is supplied, any non-null retained
//     `anchorAcId` MUST match a shipped AC in the caller's set.
//
// Notes:
//   - `bodyExcerpt` counts ONLY as a derived value, never as an
//     identifier (see the strict-shape rule).
//   - Schema versions, WAL/journal mode, binding names, profile
//     names, migration lists and template entries are DERIVED only;
//     they are never identifiers on their own (see the strict-evidence contract).
//   - A single JSON log line string that starts with `{` is derived
//     only; the caller must supply a parsed object with a message
//     field (or a request/correlation id elsewhere) to satisfy the
//     identifier half.
//   - `acceptedProfile` is never an identifier (matches the header
//     comment; the strict-evidence contract acceptedProfile mismatch).
//   - bare `note`, `templateCount:0`, `presentAfterDelete:false`
//     without a resource id, arbitrary `valueOnLine` strings, empty
//     arrays, and skip rows whose `reason` is not one declared unset
//     var name all FAIL.
//   - Dynamic `process.env[<expr>]` access is disallowed; the collector
//     emits the sentinel '__DYNAMIC__' so anatomy tests reject the file.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Regex that matches a real shipped AC id (AC-NNNN-N or AC-NN-N).
export const AC_ID_RE = /\bAC-\d{2,5}-\d{1,3}\b/;
export const AC_ID_RE_G = /\bAC-\d{2,5}-\d{1,3}\b/g;

// Collect every process.env.<NAME> read across a set of .mjs files.
// Captures both the dot-form process.env.X and the bracket form with
// a string literal. Dynamic access (process.env[<expr>] where <expr>
// is not a literal) records the sentinel '__DYNAMIC__' so anatomy
// tests reject it as a failure (never as an exemption).
export async function collectEnvReads(files) {
  const names = new Set();
  for (const p of files) {
    let text = '';
    try { text = await readFile(p, 'utf8'); } catch { continue; }
    for (const m of text.matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)\b/g)) names.add(m[1]);
    for (const m of text.matchAll(/process\.env\[\s*['"]([A-Z_][A-Z0-9_]*)['"]\s*\]/g)) names.add(m[1]);
    for (const m of text.matchAll(/process\.env\[\s*([^\]'"]+)\s*\]/g)) {
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

// Collect the shipped AC ids for a blueprint by reading every
// user-story JSON file under contributions/user-stories/.
export async function collectShippedAcIds(blueprintRoot) {
  const dir = join(blueprintRoot, 'contributions', 'user-stories');
  const acIds = new Set();
  let entries = [];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return acIds; }
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.json')) continue;
    let text = '';
    try { text = await readFile(join(dir, e.name), 'utf8'); } catch { continue; }
    let doc = null; try { doc = JSON.parse(text); } catch { continue; }
    for (const ac of doc?.acceptanceCriteria || []) {
      if (typeof ac?.id === 'string' && AC_ID_RE.test(ac.id)) acIds.add(ac.id);
    }
  }
  return acIds;
}

export async function importProbe(path) {
  return await import(pathToFileURL(path).href);
}

function nonEmptyString(v) { return typeof v === 'string' && v.trim().length > 0; }
function positiveNumber(v) { return typeof v === 'number' && Number.isFinite(v) && v > 0; }
function nonEmptyArray(v) { return Array.isArray(v) && v.length > 0; }
function nonEmptyObj(v) { return v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0; }

// Strict evidence-shape checker.
//
// opts.shippedAcIds  Set<string>  optional; if provided, every AC id
//                                 named on limitation or
//                                 notObservableHere.ac must be in it.
// opts.browserOnlyAcIds Set<string>  optional (default empty);
//                                 notObservableHere is refused unless
//                                 its `ac` is in this set - the
//                                 process-level ruling from the strict-evidence contract.
export function resultHasEvidenceShape(r, opts = {}) {
  const shippedAcIds = opts.shippedAcIds instanceof Set ? opts.shippedAcIds : null;
  const browserOnlyAcIds = opts.browserOnlyAcIds instanceof Set ? opts.browserOnlyAcIds : new Set();
  if (!r || typeof r !== 'object') return { ok: false, reason: 'result is not an object' };

  // Retained-anchor existence: whenever a row carries a non-null
  // anchorAcId (any shape below), that id MUST match a shipped AC
  // in the caller-supplied set. Rows that de-claim (conformanceOnly)
  // set anchorAcId:null and are covered by the conformanceOnly path.
  if (shippedAcIds && nonEmptyString(r.anchorAcId)) {
    if (!AC_ID_RE.test(r.anchorAcId)) return { ok: false, reason: 'anchorAcId must match AC-NNNN-N shape: ' + r.anchorAcId };
    if (!shippedAcIds.has(r.anchorAcId)) return { ok: false, reason: 'retained anchorAcId ' + r.anchorAcId + ' is not a shipped AC id in this blueprint' };
  }

  // Skip shape. `reason` must be a non-empty string; each anatomy test
  // additionally checks the reason names exactly one declared unset
  // env variable via skipReasonNamesExactlyOneDeclared.
  if (r.accountBoundSkipped === true) {
    if (nonEmptyString(r.reason)) return { ok: true, kind: 'honest-skip' };
    return { ok: false, reason: 'accountBoundSkipped without a non-empty reason string' };
  }

  // notObservableHere shape (for browser-only properties a shelf
  // probe cannot observe). Must name a real shipped AC id AND that
  // AC must be in the caller-supplied browserOnlyAcIds set -
  // process-level properties are never notObservableHere.
  if (r.notObservableHere && typeof r.notObservableHere === 'object') {
    if (!nonEmptyString(r.notObservableHere.ac)) return { ok: false, reason: 'notObservableHere.ac required' };
    if (!AC_ID_RE.test(r.notObservableHere.ac)) return { ok: false, reason: 'notObservableHere.ac must match AC-NNNN-N shape: ' + r.notObservableHere.ac };
    if (!nonEmptyString(r.notObservableHere.reason)) return { ok: false, reason: 'notObservableHere.reason required' };
    if (!browserOnlyAcIds.has(r.notObservableHere.ac)) {
      return { ok: false, reason: 'notObservableHere is only permitted for browser-only ACs (the process-level ruling); AC ' + r.notObservableHere.ac + ' is not in browserOnlyAcIds' };
    }
    if (shippedAcIds && !shippedAcIds.has(r.notObservableHere.ac)) {
      return { ok: false, reason: 'notObservableHere.ac ' + r.notObservableHere.ac + ' is not a shipped AC id in this blueprint' };
    }
    return { ok: true, kind: 'not-observable-here' };
  }

  // De-claim shape: the row acknowledges it does not observe the AC it
  // would otherwise claim; `limitation` must name a real shipped AC id
  // AND every AC id named in the limitation string must be a shipped
  // AC in this blueprint.
  if (r.conformanceOnly === true) {
    if (r.anchorAcId !== null) return { ok: false, reason: 'conformanceOnly rows must set anchorAcId:null so no AC is claimed' };
    if (!nonEmptyString(r.limitation)) return { ok: false, reason: 'conformanceOnly rows must carry a non-empty limitation naming the shipped AC' };
    if (!AC_ID_RE.test(r.limitation)) return { ok: false, reason: 'conformanceOnly.limitation must name a real shipped AC id (AC-NNNN-N): ' + r.limitation.slice(0, 120) };
    if (shippedAcIds) {
      const named = [...r.limitation.matchAll(AC_ID_RE_G)].map((m) => m[0]);
      const unknown = named.filter((ac) => !shippedAcIds.has(ac));
      if (unknown.length > 0) return { ok: false, reason: 'conformanceOnly.limitation names AC id(s) not shipped in this blueprint: ' + JSON.stringify(unknown) };
    }
    return { ok: true, kind: 'conformance-only' };
  }

  const ev = r.evidence;
  if (!ev || typeof ev !== 'object') return { ok: false, reason: 'result has neither honest skip, notObservableHere, conformanceOnly nor an evidence object' };

  // The honest-warn shortcut (a WARN row carrying a non-empty
  // unobservableReason) is refused here: a WARN row MUST also satisfy
  // one of the identifier-plus-derived, exact-skip or notObservableHere
  // (browser-only) shapes above. `unobservableReason` on its own is
  // free-form text; it is not an identifier or a derived value.

  // ─────────────────────────────────────────────────────────────
  // Strong identifiers (the strict-evidence contract tightening).
  //   Removed from identifier consideration:
  //     - pragmaJournalMode / pragmaSynchronous     (WAL/durability mode)
  //     - schemaVersion                              (schema versions)
  //     - bindingName / missingKey                   (binding names)
  //     - acceptedProfile / kind                     (profile / kind names)
  //     - migrationsApplied / migrationRows /
  //       appliedMigrations / migrationsAppliedOnReopen (migration lists)
  //     - a single JSON log-line STRING starts with `{`
  //   These remain valid DERIVED values (see below).
  // ─────────────────────────────────────────────────────────────
  // Engine-returned resource ids: stand alone as identifiers because
  // the caller did not choose them - the D1/Resend/GitHub/SQLite engine
  // minted the value and the probe recorded exactly what came back.
  const idCandidates = [
    ev.requestId, ev.createRequestId, ev.queryRequestId, ev.deleteRequestId,
    ev.inventoryRequestId,
    ev.derived?.requestId, ev.derivedLive?.requestId, ev.derivedReady?.requestId, ev.derivedStarting?.requestId,
    ev.databaseUuid,
    ev.messageId, ev.providerMessageId,
    ev.runId,
    ev.rowId, ev.rowIdCreatedThenDeleted, ev.rowIdOnRead,
  ];
  // Pairing rule (the strict-evidence contract, identifier pairing):
  // a probe-supplied value only qualifies as an identifier when the
  // engine's echo of THAT specific value is recorded alongside it.
  // Bare `suppliedInput`, `headerName`, `workflowName`, `line.correlationId`,
  // `observed[].supplied` and `observedRoundTrips[].supplied` on their
  // own are supplied inputs or on-wire reads without pairing evidence,
  // and are refused. Legitimate pairs:
  //   - suppliedInput + (derivedResponseHeader | echoedHeader | line.correlationId matching suppliedInput)
  //   - headerName    + (derivedResponseHeader | echoedHeader)
  //   - workflowName  + (runId returned for the same run record)
  //   - line.correlationId matching a probe-supplied correlationId on
  //     the same emission (suppliedInput or a per-emission entry in
  //     observedEmissions), or matching `correlationIdEchoed`
  //   - `observed[].supplied`     paired with echoedHeader | requestId | echoedBody in the same item
  //   - `observedRoundTrips[].supplied` paired with headerEcho | requestId in the same item
  const suppliedEchoPair = (
    (nonEmptyString(ev.suppliedInput) && (
      nonEmptyString(ev.derivedResponseHeader)
      || nonEmptyString(ev.echoedHeader)
      || (nonEmptyObj(ev.line) && nonEmptyString(ev.line.correlationId) && ev.line.correlationId === ev.suppliedInput)
    ))
    || (nonEmptyString(ev.headerName) && (nonEmptyString(ev.derivedResponseHeader) || nonEmptyString(ev.echoedHeader)))
    || (nonEmptyString(ev.workflowName) && (positiveNumber(ev.runId) || nonEmptyString(ev.runId)))
  );
  const lineCorrelationPair = (
    nonEmptyObj(ev.line) && nonEmptyString(ev.line.correlationId)
    && (
      (nonEmptyString(ev.suppliedInput) && ev.line.correlationId === ev.suppliedInput)
      || (nonEmptyString(ev.correlationIdEchoed) && ev.line.correlationId === ev.correlationIdEchoed)
      || (Array.isArray(ev.observedEmissions) && ev.observedEmissions.some((o) => o?.correlationId === ev.line.correlationId))
    )
  );
  const observedNestedId = (
    (Array.isArray(ev.observed) && ev.observed.some((o) => nonEmptyString(o?.supplied) && (nonEmptyString(o?.echoedHeader) || nonEmptyString(o?.requestId) || nonEmptyString(o?.echoedBody))))
    || (nonEmptyObj(ev.observed) && !Array.isArray(ev.observed) && nonEmptyString(ev.observed.supplied) && (nonEmptyString(ev.observed.echoedHeader) || nonEmptyString(ev.observed.requestId) || nonEmptyString(ev.observed.echoedBody)))
    || (Array.isArray(ev.observedRoundTrips) && ev.observedRoundTrips.some((o) => nonEmptyString(o?.supplied) && (nonEmptyString(o?.headerEcho) || nonEmptyString(o?.requestId))))
  );
  let hasIdentifier = idCandidates.some((v) => nonEmptyString(v) || positiveNumber(v)) || suppliedEchoPair || lineCorrelationPair || observedNestedId;

  // Derived-value presence: at least one non-empty derived field
  // (body excerpt, resource id, adapter outcome, event record,
  // metric delta, template list, migration list, pragma value, etc.).
  const derivedCandidates = [
    nonEmptyString(ev.bodyExcerpt), nonEmptyString(ev.queryBodyExcerpt), nonEmptyString(ev.stdoutExcerpt),
    nonEmptyString(ev.derived?.bodyExcerpt), nonEmptyString(ev.derivedLive?.bodyExcerpt), nonEmptyString(ev.derivedReady?.bodyExcerpt),
    nonEmptyString(ev.derivedStarting?.bodyExcerpt),
    nonEmptyString(ev.responseBodyEchoed),
    nonEmptyString(ev.derivedResponseBodyHash),
    positiveNumber(ev.derivedResponseBodySequence),
    nonEmptyArray(ev.derivedSequences) && ev.derivedSequences.every((n) => typeof n === 'number' && n > 0),
    nonEmptyObj(ev.line),
    nonEmptyArray(ev.linesExcerpt),
    nonEmptyString(ev.queuedLine),
    positiveNumber(ev.delta),
    nonEmptyObj(ev.checks),
    nonEmptyObj(ev.entry) && nonEmptyString(ev.entry.state) && nonEmptyString(ev.entry.checkedAt),
    typeof ev.presentAfterDelete === 'boolean' && nonEmptyString(ev.databaseUuid),
    positiveNumber(ev.rowId) || positiveNumber(ev.rowIdCreatedThenDeleted) || positiveNumber(ev.rowIdOnRead),
    nonEmptyArray(ev.migrationsApplied),
    nonEmptyArray(ev.migrationRows),
    nonEmptyArray(ev.appliedMigrations),
    nonEmptyArray(ev.migrationsAppliedOnReopen) && ev.migrationsAppliedOnReopen.every((s) => nonEmptyString(s)),
    positiveNumber(ev.schemaVersion),
    positiveNumber(ev.walSizeBefore),
    nonEmptyObj(ev.checkpoint),
    nonEmptyString(ev.pragmaJournalMode),
    nonEmptyString(ev.pragmaSynchronous),
    (nonEmptyObj(ev.event) && nonEmptyString(ev.event.event)),
    (typeof ev.event === 'string' && nonEmptyString(ev.event) && nonEmptyString(ev.timestamp)),
    nonEmptyObj(ev.entryPut),
    nonEmptyString(ev.pathFromConfig) && nonEmptyString(ev.pathOnEvent),
    nonEmptyString(ev.kind) && nonEmptyString(ev.bindingName),
    nonEmptyString(ev.refusalMessage) && nonEmptyString(ev.missingKey),
    nonEmptyString(ev.acceptedProfile) && (ev.resolvedTransport || nonEmptyObj(ev.resolvedPaths)),
    (nonEmptyString(ev.providerMessageId) && positiveNumber(ev.providerStatus)),
    nonEmptyString(ev.messageId),
    nonEmptyObj(ev.envelope) && nonEmptyString(ev.envelope.from),
    typeof ev.recipientInError === 'boolean' && ev.recipientInError === false && nonEmptyString(ev.errorString),
    typeof ev.recipientInRefusal === 'boolean' && ev.recipientInRefusal === false && nonEmptyString(ev.lastLine),
    positiveNumber(ev.code) && nonEmptyString(ev.lastLine),
    nonEmptyArray(ev.parsedComponents) && ev.parsedComponents.every((c) => nonEmptyString(c?.nameAttr) && nonEmptyString(c?.stateAttr)),
    nonEmptyArray(ev.stateAttrs),
    nonEmptyArray(ev.renderedOrder),
    nonEmptyArray(ev.perFile),
    nonEmptyArray(ev.entries),
    nonEmptyArray(ev.commitEntries),
    ((positiveNumber(ev.runId) || nonEmptyString(ev.runId)) && nonEmptyString(ev.conclusion)),
    (nonEmptyString(ev.workflowName) && nonEmptyString(ev.conclusion)),
    nonEmptyArray(ev.observedRoundTrips) && ev.observedRoundTrips.every((o) => nonEmptyObj(o) && (positiveNumber(o.bodySequence) || nonEmptyString(o.bodyHash) || nonEmptyString(o.headerEcho))),
    nonEmptyArray(ev.observed) && ev.observed.every((o) => nonEmptyObj(o)),
    nonEmptyString(ev.derivedResponseHeader) && nonEmptyString(ev.suppliedInput),
    // The single JSON log-line STRING is derived only (the strict-evidence contract).
    nonEmptyString(ev.line) && ev.line.trim().startsWith('{'),
  ];
  let hasDerived = derivedCandidates.some((v) => v === true);

  // Additional identifier candidates. Deliberately kept narrow:
  // the strict-evidence contract tightening removes error strings, log objects with a
  // `message`, `linesExcerpt` arrays, `startsWithClass` prefixes and
  // a locally invented `callTrackingId` from the identifier set -
  // an identifier must be a request id, resource id (uuid / message
  // id / row id / server id / file path of a created artefact) or a
  // vendor-returned id. What remains after the identifier pairing rule is:
  //   - variedInput paired with observed.echoedHeader (a single-value pair);
  //   - correlationIdEchoed proven on the wire (matches line.correlationId
  //     or appears verbatim in linesExcerpt) - the bare value alone is a
  //     supplied read and no longer qualifies.
  const extraId = (
    (nonEmptyString(ev.variedInput) && nonEmptyObj(ev.observed) && !Array.isArray(ev.observed) && nonEmptyString(ev.observed.echoedHeader) && ev.observed.echoedHeader === ev.variedInput)
    || (
      nonEmptyString(ev.correlationIdEchoed) && (
        (nonEmptyObj(ev.line) && ev.line.correlationId === ev.correlationIdEchoed)
        || (nonEmptyArray(ev.linesExcerpt) && ev.linesExcerpt.some((s) => typeof s === 'string' && s.includes(ev.correlationIdEchoed)))
      )
    )
  );
  if (extraId) hasIdentifier = true;

  // Additional derived candidates.
  const extraDerived = (
    (nonEmptyString(ev.errorString) && ev.recipientInError === false && ev.subjectInError === false && ev.bodyInError === false)
    || (nonEmptyObj(ev.observed) && nonEmptyObj(ev.observed.checks))
    || (nonEmptyObj(ev.line) && nonEmptyString(ev.line.message) && nonEmptyString(ev.line.level))
    || (nonEmptyString(ev.acceptedProfile) && (nonEmptyString(ev.semanticModel) || nonEmptyObj(ev.semanticModel)))
    || (nonEmptyString(ev.errorString) && typeof ev.startsWithClass === 'boolean')
    || (typeof ev.ok === 'boolean' && positiveNumber(ev.providerStatus) && (nonEmptyString(ev.errorString) || nonEmptyString(ev.messageId)))
    || (nonEmptyArray(ev.linesExcerpt) && nonEmptyArray(ev.levelsSeen))
    || (nonEmptyArray(ev.shape) && ev.shape.every((s) => nonEmptyObj(s) && nonEmptyString(s.name)))
    || (nonEmptyObj(ev.observed) && ev.observed.contentLength === '0' && typeof ev.observed.bodyLength === 'number' && ev.observed.bodyLength === 0 && (ev.observed.status === 503 || ev.observed.status === 200))
    || (nonEmptyString(ev.userPiiEmailOnLine) && nonEmptyString(ev.userIdOnLine))
    || (nonEmptyString(ev.limitationBodyExcerpt))
    || (typeof ev.credentialLeakAbsent === 'boolean' && ev.credentialLeakAbsent === true && nonEmptyString(ev.refusalMessage))
    || (typeof ev.consumerConfiguresPragmas === 'boolean' && ev.consumerConfiguresPragmas === false && nonEmptyString(ev.pragmaJournalMode))
    || (nonEmptyString(ev.livenessPathDistinct) && nonEmptyString(ev.readinessPathFromConfig))
  );
  if (extraDerived) hasDerived = true;

  if (hasIdentifier && hasDerived) return { ok: true, kind: 'id+derived' };
  if (!hasIdentifier) return { ok: false, reason: `evidence object present but no non-empty identifier / request id / echoed header / resource id recognised: ${JSON.stringify(ev).slice(0, 200)}` };
  return { ok: false, reason: `evidence object has identifier but no non-empty derived value/body/excerpt/hash/list/adapter outcome recognised: ${JSON.stringify(ev).slice(0, 200)}` };
}

// Assert that a skip row's `reason` names exactly ONE declared variable
// from `declared`. Returns { ok, reason } for anatomy tests to assert on.
export function skipReasonNamesExactlyOneDeclared(reason, declared) {
  if (!nonEmptyString(reason)) return { ok: false, reason: 'skip reason must be a non-empty string' };
  const decls = declared instanceof Set ? [...declared] : Array.from(declared || []);
  const named = decls.filter((v) => new RegExp('\\b' + v + '\\b').test(reason));
  if (named.length === 1) return { ok: true, named: named[0] };
  return { ok: false, reason: 'skip reason must name exactly one declared variable; named=' + JSON.stringify(named) + ' declared=' + JSON.stringify(decls) };
}
