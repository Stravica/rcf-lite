// `rcf feedback` core verb (TAC-4101). Slice 2 (FBS-181) adds the
// `preview` sub-verb on top of slice 1's capture and store:
//   add        record one finding (silent, local; no network)
//   list       print pending entries (--all includes every state; --json)
//   status     counts + gh availability (gh probing lands in slice 4;
//              slice 2 still reports the local-only summary)
//   defer      mark all pending entries deferredUntilSession
//   discard    mark named (or --all) entries discarded
//   preview    render the exact issue title, body and redaction ledger
//              for every pending entry; read-only, no network
//
// Sub-verbs from later slices are registered here as "not yet available"
// stubs so `rcf feedback submit|opt-in|opt-out|hook` return the
// documented usage-plus-outcome exit code (3) with a one-line note
// naming the slice that ships them. This keeps the RULE 17 block
// referable at slice-2 time without inventing verb behaviour ahead of
// the ACs. Sub-verb argv parsing lives in each handler so each verb's
// flag surface is local.
//
// The verb is CORE (not grouped), because it spans discover-to-audit
// scope and is invoked from harness hooks (design §3.1). See
// `bin/rcf.js:CORE`.

import { readFile, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { platform as osPlatform } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import process from 'node:process';

const execFileP = promisify(execFile);

import { findProjectRoot } from '../view/index.js';
import {
  appendEntry,
  appendState,
  ensureGitignore,
  mintUniqueEntryId,
  newEntryId,
  readAskLedger,
  readDiscardTimestamps,
  readEntries,
  readFeedbackSettings,
  storeExists,
  writeAskLedger,
  writeFeedbackSettings,
} from '../feedback/store.js';
import {
  buildAskReason,
  buildCarryOverLine,
  emit as emitHook,
  emitSessionStart,
  shouldAsk,
} from '../feedback/hook.js';
import { redact, allowedHosts, findResidualSecrets } from '../feedback/redact.js';
import { fingerprint } from '../feedback/fingerprint.js';
import { renderIssue, renderComment, renderBundle } from '../feedback/render.js';
import { resolve as resolveDestination, listUnresolvedLibraries, findBlueprintRecord } from '../feedback/destination.js';
import { readLibraryRegistry } from '../blueprint/library-registry.js';
import { loadGhAdapter } from '../feedback/gh.js';
import { labelsForEntry } from '../feedback/labels.js';
import { outboxDir } from '../feedback/store.js';
import { mkdir, readdir, writeFile } from 'node:fs/promises';

const here = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(here, '..', '..');

/** Closed enum from design §6. Any other value on --class exits 2. */
export const SYMPTOM_CLASSES = Object.freeze([
  'docs-mismatch',
  'validate-fails',
  'apply-fails',
  'internal-contradiction',
  'stale-citation',
  'missing-scenario',
  'verb-error',
  'verb-hang',
  'wrong-output',
  'other',
]);

/** Severity enum (design §3.1). */
export const SEVERITIES = Object.freeze(['blocker', 'major', 'minor']);

/** Kind enum. */
export const KINDS = Object.freeze(['blueprint', 'core']);

/** Body size cap (bytes, design §5 rule 7). */
export const BODY_CAP_BYTES = 8 * 1024;

/** Title char cap (design §3.1). */
export const TITLE_CAP_CHARS = 120;

export const HELP = `Usage: rcf feedback <sub-verb> [options]

Sub-verbs (available):
  add        Record one finding to the local log (no network, no ask).
  list       Print pending entries (--all includes every state, --json).
  status     Counts, opt-out state, gh availability summary.
  defer      Mark all pending entries deferred for the current session.
  discard    Mark named entries discarded (or --all).
  preview    Render the exact issue text and redaction ledger for each
             pending entry; read-only, no network.
  submit     File each pending entry under the reporter's ambient gh
             login; --yes is required. Runs preflight (gh, auth, repo
             access, issues-enabled), a fingerprint dedupe search, then
             either creates the issue, comments on a match, or writes
             a bundle to .rcf/feedback/outbox/ and prints the paste
             URL. See docs/feedback.md for the full walk.
  opt-out    Silence the per-session ask for this project by writing
             rcf/feedback-settings.json:ask false. add / preview /
             submit keep working (hand-driven flow).
  opt-in     Restore the ask (writes rcf/feedback-settings.json:ask true).
  hook       Harness hook handler (Stop / SessionEnd / SessionStart).
             Reads harness JSON from stdin; applies the quiet rule
             (design 3.5); on Claude Code, Stop exits 2 with the ask
             on stderr; on Codex, stdout carries the block JSON.
             Sub-shape: rcf feedback hook <stop|session-end|session-start>
                        [--harness claude-code|codex].

Common options:
  --help                Print this help.
  --json                Machine-readable output (list, status).

'rcf feedback add' options (all required unless noted):
  --kind blueprint|core         What the finding is about.
  --target <ref>                Blueprint slug, prefix:slug or verb path.
  --anchor <id>                 AC / REQ / TAC / ADR id, or verb name.
                                Optional but strongly recommended for
                                dedupe folding.
  --class <symptom-class>       One of ${SYMPTOM_CLASSES.join(', ')}.
  --severity blocker|major|minor
  --title <text>                <= ${TITLE_CAP_CHARS} chars.
  --body <text> | --body-file <path>
                                Body markdown, <= ${BODY_CAP_BYTES / 1024} KB
                                after UTF-8 encoding.
  --evidence <pointer>          Required, repeatable: a command, a
                                path:line inside the project, or an id.
                                At least one --evidence is required
                                (AC-15501-1); absence exits 2.
  --harness claude-code|codex|other
                                Optional; inferred from env when absent.
  --ask-now                     Blocker shortcut; flags the batch so the
                                next Stop hook asks regardless of the
                                15-minute quiet rule (slice 5).
  --force                       Bypass the .gitignore pre-write refusal.

Exit codes:
  0  success
  2  usage error (bad flags, unknown enum, oversize body, no ignore
     coverage without --force)
  3  add: --kind blueprint AND the target is absent from
     rcf/manifest.json:blueprints[] (unknown target). A known target
     whose registered library has no resolvable feedback destination
     is exit 0 with the entry stamped destination:unresolved; submit
     writes a bundle at that entry's slot.
     submit / preview: at least one entry stayed pending because of a
     residual-secret refusal after redaction.
`;

/**
 * Core-verb entry point. Signature matches the other CORE handlers
 * dispatched from `bin/rcf.js:CORE`.
 *
 * @param {string[]} argv - argv slice after `feedback`
 * @param {object} [deps]
 * @param {NodeJS.WritableStream} [deps.stdout]
 * @param {NodeJS.WritableStream} [deps.stderr]
 * @param {string} [deps.cwd]
 * @param {NodeJS.ProcessEnv} [deps.env]
 * @param {() => Date} [deps.now]
 * @param {() => number} [deps.rng]
 * @param {string} [deps.sessionId]
 * @returns {Promise<number>}
 */
export async function main(argv, deps = {}) {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const cwd = deps.cwd ?? process.cwd();
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());
  const rng = deps.rng ?? Math.random;
  const sessionId = deps.sessionId ?? env.RCF_FEEDBACK_SESSION_ID ?? 'unknown';

  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    stdout.write(HELP);
    return argv.length === 0 ? 2 : 0;
  }

  const sub = argv[0];
  const rest = argv.slice(1);
  const ctx = { stdout, stderr, cwd, env, now, rng, sessionId };
  switch (sub) {
    case 'add':      return handleAdd(rest, ctx);
    case 'list':     return handleList(rest, ctx);
    case 'status':   return handleStatus(rest, ctx);
    case 'defer':    return handleDefer(rest, ctx);
    case 'discard':  return handleDiscard(rest, ctx);
    case 'preview':  return handlePreview(rest, ctx);
    case 'submit':   return handleSubmit(rest, ctx);
    case 'opt-in':   return handleOptToggle('opt-in', rest, ctx);
    case 'opt-out':  return handleOptToggle('opt-out', rest, ctx);
    case 'hook':     return handleHook(rest, ctx);
    default:
      stderr.write(`[error] usage unknown feedback sub-verb '${sub}'\n`);
      stdout.write(HELP);
      return 2;
  }
}

// -- add -------------------------------------------------------------------

const ADD_OPTIONS = /** @type {const} */ ({
  kind:       { type: 'string' },
  target:     { type: 'string' },
  anchor:     { type: 'string' },
  class:      { type: 'string' },
  severity:   { type: 'string' },
  title:      { type: 'string' },
  body:       { type: 'string' },
  'body-file': { type: 'string' },
  evidence:   { type: 'string', multiple: true },
  harness:    { type: 'string' },
  'ask-now':  { type: 'boolean' },
  force:      { type: 'boolean' },
  help:       { type: 'boolean' },
});

async function handleAdd(argv, ctx) {
  const { stdout, stderr, cwd, env } = ctx;
  // F-slice-1-02: RCF_FEEDBACK_DISABLE=1 makes `add` a no-op that
  // prints the design-8 line and exits 0 without touching the tree.
  // Locked-down environments where even a local log is unwanted rely
  // on this; the previous build honoured only the opt-out semantics
  // in `status`, so `add` would still persist raw entries.
  if (env.RCF_FEEDBACK_DISABLE === '1') {
    stdout.write('feedback disabled by env\n');
    return 0;
  }
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: ADD_OPTIONS, allowPositionals: false, strict: true });
  } catch (err) {
    stderr.write(`[error] usage ${err.message}\n`);
    return 2;
  }
  const flags = parsed.values;
  if (flags.help) { stdout.write(HELP); return 0; }

  // Enum + presence checks BEFORE any project-root probing so a usage
  // error never touches the tree.
  const kind = flags.kind;
  if (!kind || !KINDS.includes(kind)) {
    stderr.write(`[error] usage --kind must be one of ${KINDS.join(', ')}\n`);
    return 2;
  }
  const symptomClass = flags.class;
  if (!symptomClass || !SYMPTOM_CLASSES.includes(symptomClass)) {
    stderr.write(`[error] usage --class must be one of ${SYMPTOM_CLASSES.join(', ')}\n`);
    return 2;
  }
  const severity = flags.severity;
  if (!severity || !SEVERITIES.includes(severity)) {
    stderr.write(`[error] usage --severity must be one of ${SEVERITIES.join(', ')}\n`);
    return 2;
  }
  const target = flags.target;
  if (!target) { stderr.write('[error] usage --target is required\n'); return 2; }
  const title = flags.title;
  if (!title) { stderr.write('[error] usage --title is required\n'); return 2; }
  if (title.length > TITLE_CAP_CHARS) {
    stderr.write(`[error] usage --title exceeds ${TITLE_CAP_CHARS} character cap (got ${title.length})\n`);
    return 2;
  }
  const evidence = flags.evidence ?? [];
  if (evidence.length === 0) {
    stderr.write('[error] usage --evidence is required (repeatable)\n');
    return 2;
  }
  const harness = flags.harness ?? inferHarness(ctx.env);
  if (flags.harness && !['claude-code', 'codex', 'other'].includes(flags.harness)) {
    stderr.write('[error] usage --harness must be one of claude-code, codex, other\n');
    return 2;
  }

  // Body: either --body or --body-file, exactly one, capped at 8 KB.
  if (flags.body != null && flags['body-file'] != null) {
    stderr.write('[error] usage pass either --body or --body-file, not both\n');
    return 2;
  }
  let body;
  if (flags.body != null) {
    body = flags.body;
  } else if (flags['body-file'] != null) {
    try {
      body = await readFile(resolve(cwd, flags['body-file']), 'utf8');
    } catch (err) {
      stderr.write(`[error] usage --body-file: ${err.message}\n`);
      return 2;
    }
  } else {
    stderr.write('[error] usage one of --body or --body-file is required\n');
    return 2;
  }
  const bodyBytes = Buffer.byteLength(body, 'utf8');
  if (bodyBytes > BODY_CAP_BYTES) {
    stderr.write(`[error] usage --body exceeds ${BODY_CAP_BYTES} byte cap (got ${bodyBytes})\n`);
    return 2;
  }

  // Find the project root; without a manifest we cannot honour the
  // gitignore refusal or the destination resolution.
  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    stderr.write('[error] usage no project root found (no rcf/manifest.json in this directory or any ancestor). Run `npx rcf init` to scaffold and wire a project.\n');
    return 2;
  }

  // Gitignore pre-write refusal. --force bypasses.
  if (!flags.force) {
    const check = await ensureGitignore(projectRoot);
    if (!check.ok) {
      stderr.write(`[error] usage ${check.reason}. Run \`rcf doctor --fix\` to add the managed .gitignore entry (or pass --force to write anyway).\n`);
      return 2;
    }
  }

  // Destination resolution (design 3.3, slice 3 landed the resolver).
  // Runs at add-time so the entry carries its declared destination
  // through preview and submit; preview re-resolves defensively so a
  // library that later declared an issues field lifts a previously
  // stamped `unresolved` entry to a real destination.
  const resolverInputs = await loadResolverInputs(projectRoot);
  const record = kind === 'blueprint'
    ? await lookupBlueprintRecord(projectRoot, target)
    : null;
  // Build a resolver-shaped entry for the pre-write resolve call: the
  // real feedback entry does not exist yet, but the resolver only reads
  // { kind, target.ref } and the manifest for lookup.
  const preResolveEntry = { kind, target: { ref: target } };
  const resolvedDestination = await resolveDestination(preResolveEntry, resolverInputs);
  // Design 3.1 exit-3 branch: the blueprint TARGET could not be found
  // on the manifest at all (unknown-target). A library whose registry
  // entry lacks an issuesRepo (or whose sourceRef is not a github URL)
  // stamps the entry as unresolved but stays exit 0 (design 7 case 5:
  // slice 4 writes the bundle at submit time).
  const destinationUnresolved = resolvedDestination.visibility === 'unresolved';
  const targetUnknown = destinationUnresolved && resolvedDestination.reason === 'unknown-target';

  // Environment stamp (design §3.6, F-2 extended).
  const environment = {
    harness,
    rcfLiteVersion: await readOwnVersion(),
    nodeVersion: process.versions.node,
    platform: osPlatform(),
  };

  // Blueprint-specific stamps (AC-15501-5, F-slice-1-07: also merge
  // registry-sourced libraryRef and pin.tarballSha256 which live on
  // rcf/blueprint-libraries.json, not on the manifest record).
  let blueprintStamp = {};
  if (kind === 'blueprint' && record) {
    const registryEntry = record.libraryPrefix && resolverInputs.registry
      ? (Array.isArray(resolverInputs.registry.libraries)
        ? resolverInputs.registry.libraries.find((l) => l?.libraryPrefix === record.libraryPrefix)
        : null)
      : null;
    const libraryRef = record.libraryRef ?? registryEntry?.libraryRef ?? null;
    const resolvedSha = record.pin?.resolvedSha ?? registryEntry?.resolvedSha ?? null;
    const tarballSha256 = record.pin?.tarballSha256 ?? registryEntry?.provenance?.tarballSha256 ?? null;
    blueprintStamp = {
      blueprintVersion: record.version ?? null,
      libraryPrefix: record.libraryPrefix ?? null,
      libraryRef,
      ...(resolvedSha ? { resolvedSha } : {}),
      ...(tarballSha256 ? { tarballSha256 } : {}),
    };
  }

  const recordedAt = ctx.now().toISOString().replace(/\.\d{3}Z$/, 'Z');
  // F-slice-1-03 / ruling R2: 12-hex id with a uniqueness probe on
  // the append. mintUniqueEntryId THROWS FEEDBACK_ID_EXHAUSTED if
  // every attempt collides (fail-closed, fix round 2): a colliding
  // id would violate R2's "no two rows share an id" shape, so we
  // refuse the write and surface the fault instead of appending a
  // duplicate row the reader would fold into a state transition.
  let id;
  try {
    id = await mintUniqueEntryId(projectRoot, ctx.now(), ctx.rng);
  } catch (err) {
    if (err && err.code === 'FEEDBACK_ID_EXHAUSTED') {
      stderr.write(`[error] usage ${err.message}\n`);
      return 2;
    }
    throw err;
  }

  const entryPreFingerprint = {
    id,
    recordedAt,
    sessionId: ctx.sessionId,
    kind,
    target: {
      ref: target,
      ...(kind === 'blueprint' ? {
        effectiveSlug: record?.slug ?? target,
        ...blueprintStamp,
      } : {}),
    },
    anchor: flags.anchor ?? null,
    symptomClass,
    severity,
    title,
    body,
    evidence: evidence.map((v) => classifyEvidence(v)),
    environment,
    askNow: Boolean(flags['ask-now']),
  };
  // F-slice-1-12: persist the fingerprint so `list --json`, `status`
  // and any triage-side tooling can key off it without re-computing.
  // The persisted value MUST equal what preview and submit compute
  // from the same entry.
  const fp = fingerprint(entryPreFingerprint);
  const entry = {
    ...entryPreFingerprint,
    fingerprint: fp,
    status: 'pending',
    destination: destinationUnresolved
      // Preserve the slice-1 shape ({ reason: 'unresolved' }) that
      // existing tests and the preview-time re-resolve rely on; the
      // resolver's granular reason (unknown-target vs no-issues-field
      // vs no-github-source vs no-libraryprefix-record) is recomputed
      // at preview and submit time.
      ? { reason: 'unresolved', resolverReason: resolvedDestination.reason ?? 'unresolved' }
      : {
        repo: resolvedDestination.repo,
        visibility: resolvedDestination.visibility,
        kind: resolvedDestination.kind,
        derived: resolvedDestination.derived,
        ...(resolvedDestination.source ? { source: resolvedDestination.source } : {}),
        ...(resolvedDestination.publisherContact ? { publisherContact: resolvedDestination.publisherContact } : {}),
      },
  };

  await appendEntry(projectRoot, entry);

  // F-slice-1-09: prune discarded entries older than 30 days so the
  // log does not grow unbounded (design 3.1 L137). The prune is a
  // set of state transitions, not a rewrite of the JSONL; a discarded
  // entry older than the window gains a new `pruned` state line so
  // the reader's fold-by-id drops it from `list --all` counts too.
  await pruneOldDiscarded(projectRoot, ctx.now());

  // Count of pending entries after this write (fold-by-id read).
  const all = await readEntries(projectRoot);
  const pending = all.filter((e) => e.status === 'pending').length;

  stdout.write(`recorded ${id} (${pending} pending). Nothing sent.\n`);

  if (targetUnknown) {
    // Design 3.1 exit-3: --kind blueprint but the target does not
    // appear on rcf/manifest.json:blueprints[]. The entry is still
    // recorded so the operator can rewrite the target and re-preview.
    stderr.write(`destination unresolved: ${target}\n`);
    return 3;
  }
  if (destinationUnresolved) {
    // Design 7 case 5: the target resolved to a library whose registry
    // entry has no issuesRepo and no derivable github source. Entry is
    // stamped unresolved and stays pending; slice 4 writes the bundle
    // at submit time and prints the publisher contact.
    stderr.write(`destination unresolved for library '${record?.libraryPrefix ?? '<unknown>'}': ${resolvedDestination.reason ?? 'unresolved'}. The entry is kept; \`rcf feedback submit\` will write a bundle instead of filing an issue.\n`);
  }
  return 0;
}

/**
 * Classify an evidence pointer into `{ kind, value }`. A colon-separated
 * `path:line` pattern is 'file'; a bare identifier that looks like an
 * upper-cased id is 'id'; anything else is 'command'. The classification
 * is best-effort and does not gate the write.
 *
 * @param {string} value
 * @returns {{ kind: 'file' | 'id' | 'command', value: string }}
 */
export function classifyEvidence(value) {
  if (/^[A-Z]+-\d[\w-]*$/.test(value)) return { kind: 'id', value };
  if (/^[^\s].*:\d+$/.test(value)) return { kind: 'file', value };
  return { kind: 'command', value };
}

// -- list ------------------------------------------------------------------

const LIST_OPTIONS = /** @type {const} */ ({
  all:  { type: 'boolean' },
  json: { type: 'boolean' },
  help: { type: 'boolean' },
});

async function handleList(argv, ctx) {
  const { stdout, stderr, cwd } = ctx;
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: LIST_OPTIONS, allowPositionals: false, strict: true });
  } catch (err) {
    stderr.write(`[error] usage ${err.message}\n`);
    return 2;
  }
  const flags = parsed.values;
  if (flags.help) { stdout.write(HELP); return 0; }

  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    stderr.write('[error] usage no project root found (no rcf/manifest.json in this directory or any ancestor).\n');
    return 2;
  }

  const all = await readEntries(projectRoot);
  const shown = flags.all ? all : all.filter((e) => e.status === 'pending');
  // Round 3 (F-slice-1-09 regression): a pruned entry's body and
  // title stayed visible through `list --all --json` because the
  // fold-by-id spread merged the pruned state row over the original
  // entry without clearing the free-form content. The prune sweep's
  // point is to age content out; scrub it here so `list` on either
  // surface never re-exposes a pruned body.
  const sanitised = shown.map((e) => (e.status === 'pruned'
    ? { ...e, title: null, body: null, evidence: [] }
    : e));

  if (flags.json) {
    stdout.write(`${JSON.stringify(sanitised, null, 2)}\n`);
    return 0;
  }
  if (sanitised.length === 0) {
    stdout.write(flags.all
      ? 'no feedback entries.\n'
      : 'no pending feedback entries.\n');
    return 0;
  }
  const rows = sanitised.slice().sort((a, b) => (a.recordedAt ?? '').localeCompare(b.recordedAt ?? ''));
  for (const e of rows) {
    const statusCol = flags.all ? `[${e.status}] ` : '';
    const titleText = e.status === 'pruned' ? '(pruned; body scrubbed)' : e.title;
    stdout.write(`${statusCol}${e.id}  ${e.target?.ref ?? '?'}  ${e.symptomClass}  ${e.severity}  ${titleText}\n`);
  }
  return 0;
}

// -- status ----------------------------------------------------------------

const STATUS_OPTIONS = /** @type {const} */ ({
  json: { type: 'boolean' },
  help: { type: 'boolean' },
});

async function handleStatus(argv, ctx) {
  const { stdout, stderr, cwd, env } = ctx;
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: STATUS_OPTIONS, allowPositionals: false, strict: true });
  } catch (err) {
    stderr.write(`[error] usage ${err.message}\n`);
    return 2;
  }
  const flags = parsed.values;
  if (flags.help) { stdout.write(HELP); return 0; }

  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    stderr.write('[error] usage no project root found (no rcf/manifest.json in this directory or any ancestor).\n');
    return 2;
  }

  const exists = await storeExists(projectRoot);
  const all = exists ? await readEntries(projectRoot) : [];
  const counts = countByStatus(all);
  // Precedence (design section 8): env DISABLE > env ASK=0 > file
  // ask false > file ask true (the default). The status view names
  // the resolved source so the operator can tell whether an ask
  // will fire without inspecting the file.
  const settingsRead = await readFeedbackSettings(projectRoot);
  const fileAskOff = settingsRead.settings.ask === false;
  const optOut = env.RCF_FEEDBACK_DISABLE === '1'
    || env.RCF_FEEDBACK_ASK === '0'
    || fileAskOff;
  // Destination coverage across the library registry (design 3.1;
  // slice 3 landed the resolver). A parseable-but-empty registry means
  // no libraries are declared, so nothing to warn about. A broken
  // registry is treated as "no libraries" here; the doctor
  // feedback-destinations check surfaces the parse failure instead.
  const registryRead = await readLibraryRegistry(projectRoot);
  const registry = (registryRead && typeof registryRead === 'object' && 'kind' in registryRead)
    ? { libraries: [] }
    : registryRead;
  const unresolvedLibraries = listUnresolvedLibraries(registry);
  // Slice 4 (FBS-183): probe gh availability once so `rcf feedback
  // status` warns the operator when submit would fall through to a
  // bundle. A failed probe never fails status; the summary just
  // records what the probe saw.
  const ghSummary = await probeGhSummary(env);
  // Per-blueprint destination table (design 3.1 L140): for every
  // applied blueprint on the manifest, show the destination the
  // resolver would return today. Read-only, no network. Collected
  // BEFORE the JSON early-return so --json carries the same table
  // the text path prints (F-slice-1-10 fix round 2).
  const resolverInputsStatus = await loadResolverInputs(projectRoot);
  const appliedBlueprints = Array.isArray(resolverInputsStatus.manifest?.blueprints)
    ? resolverInputsStatus.manifest.blueprints
    : [];
  const destinationTable = [];
  for (const r of appliedBlueprints) {
    const ref = r.libraryPrefix
      ? `${r.libraryPrefix}:${r.slug}`
      : (r.slug ?? r.name ?? '(unnamed)');
    const dest = await resolveDestination(
      { kind: 'blueprint', target: { ref } },
      resolverInputsStatus,
    );
    destinationTable.push({
      ref,
      repo: dest.repo ?? null,
      visibility: dest.visibility ?? 'unresolved',
      derived: !!dest.derived,
      reason: dest.reason ?? null,
    });
  }

  const summary = {
    counts,
    optOut,
    optOutSource: optOut
      ? (env.RCF_FEEDBACK_DISABLE === '1'
        ? 'env:RCF_FEEDBACK_DISABLE'
        : (env.RCF_FEEDBACK_ASK === '0'
          ? 'env:RCF_FEEDBACK_ASK=0'
          : 'file:rcf/feedback-settings.json'))
      : null,
    quietMinutes: settingsRead.settings.quietMinutes,
    storePath: '.rcf/feedback/entries.jsonl',
    gh: ghSummary,
    destinations: {
      registeredLibraries: Array.isArray(registry?.libraries) ? registry.libraries.length : 0,
      unresolvedLibraries,
      table: destinationTable,
    },
  };

  if (flags.json) {
    stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return 0;
  }
  stdout.write(`feedback: ${counts.pending} pending, ${counts.submitted} submitted, ${counts.bundled} bundled, ${counts.deferredUntilSession} deferred, ${counts.discarded} discarded, ${counts.pruned} pruned\n`);
  stdout.write(`opt-out: ${optOut ? `yes (${summary.optOutSource})` : 'no'}\n`);
  stdout.write(`gh: ${ghSummary.present ? (ghSummary.authed ? 'installed, authed on github.com' : 'installed, not logged in (submit will bundle)') : 'not installed (submit will bundle)'}\n`);
  if (summary.destinations.unresolvedLibraries.length > 0) {
    stdout.write(`destinations: ${summary.destinations.unresolvedLibraries.length} of ${summary.destinations.registeredLibraries} registered librar${summary.destinations.registeredLibraries === 1 ? 'y has' : 'ies have'} no resolvable destination:\n`);
    // F-slice-3-04: text output must LIST every unresolved library
    // (design 3.3 L163); JSON already emits the array.
    for (const u of summary.destinations.unresolvedLibraries) {
      const contact = u.publisherContact ? ` (contact: ${u.publisherContact})` : '';
      stdout.write(`  - ${u.libraryPrefix}: ${u.reason}${contact}\n`);
    }
  } else if (summary.destinations.registeredLibraries > 0) {
    stdout.write(`destinations: all ${summary.destinations.registeredLibraries} registered librar${summary.destinations.registeredLibraries === 1 ? 'y resolves' : 'ies resolve'} to a feedback destination.\n`);
  }
  if (destinationTable.length > 0) {
    stdout.write(`applied blueprints (${destinationTable.length}):\n`);
    for (const row of destinationTable) {
      const cell = row.repo
        ? `${row.repo} (${row.visibility}${row.derived ? ', derived' : ''})`
        : `(unresolved${row.reason ? `: ${row.reason}` : ''})`;
      stdout.write(`  - ${row.ref} -> ${cell}\n`);
    }
  }
  return 0;
}

/**
 * Probe the gh adapter for install + auth state. Slice 4 wires this;
 * the returned shape is what `feedback status --json` emits under
 * `gh`. A failed probe never throws.
 *
 * @param {NodeJS.ProcessEnv} env
 */
async function probeGhSummary(env) {
  try {
    const gh = await loadGhAdapter(env);
    const path = await gh.ghOnPath();
    const present = !!(path.ok && path.value?.present !== false);
    if (!present) {
      return { present: false, authed: false, host: 'github.com', note: 'gh not on PATH' };
    }
    const auth = await gh.ghAuthStatus({ host: 'github.com' });
    return {
      present: true,
      authed: !!auth.ok,
      host: 'github.com',
      note: auth.ok ? null : 'run `gh auth login` to enable submit',
    };
  } catch (err) {
    return { present: null, authed: null, host: 'github.com', note: `probe failed: ${err.message}` };
  }
}

function countByStatus(entries) {
  // F-slice-1-09 fix: `pruned` is a real state now that retention
  // sweeps stamp it, so status counts it too. Without this the count
  // line silently under-reported the store.
  const c = {
    pending: 0, submitted: 0, bundled: 0, deferredUntilSession: 0, discarded: 0, pruned: 0,
  };
  for (const e of entries) {
    if (Object.prototype.hasOwnProperty.call(c, e.status)) c[e.status] += 1;
  }
  return c;
}

// -- defer -----------------------------------------------------------------

const DEFER_OPTIONS = /** @type {const} */ ({
  help: { type: 'boolean' },
});

async function handleDefer(argv, ctx) {
  const { stdout, stderr, cwd } = ctx;
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: DEFER_OPTIONS, allowPositionals: false, strict: true });
  } catch (err) {
    stderr.write(`[error] usage ${err.message}\n`);
    return 2;
  }
  const flags = parsed.values;
  if (flags.help) { stdout.write(HELP); return 0; }

  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    stderr.write('[error] usage no project root found (no rcf/manifest.json in this directory or any ancestor).\n');
    return 2;
  }
  const all = await readEntries(projectRoot);
  const pending = all.filter((e) => e.status === 'pending');
  if (pending.length === 0) {
    stdout.write('no pending feedback entries to defer.\n');
    return 0;
  }
  const at = ctx.now().toISOString().replace(/\.\d{3}Z$/, 'Z');
  for (const e of pending) {
    await appendState(projectRoot, {
      id: e.id, at, status: 'deferredUntilSession', sessionId: ctx.sessionId,
    });
  }
  stdout.write(`deferred ${pending.length} entr${pending.length === 1 ? 'y' : 'ies'} for session ${ctx.sessionId}.\n`);
  return 0;
}

/**
 * Requeue entries that were `deferredUntilSession` under a prior
 * `sessionId` back to `pending` for the current session. Called from
 * both `runSessionStartHook` and `runStopHook` so a defer taken in
 * session A returns to the ask queue in session B whether the
 * SessionStart hook is installed or not (design 3.1: defer = "not
 * now", ask again next session; AC-16103-3).
 *
 * The transition line writes `{ id, at, status: 'pending' }` with
 * NO `sessionId` field, so fold-by-id preserves the entry's prior
 * `sessionId` (the session it was last deferred in). That keeps the
 * `anyCarriedOver` gate in both hooks naturally true in the new
 * session: `pending.sessionId !== currentSessionId`.
 *
 * Idempotent per session: entries whose folded `sessionId` already
 * equals the current session (a fresh add this session, or a
 * previous requeue for this same session) are skipped.
 *
 * @param {string} projectRoot
 * @param {string | undefined} sessionId
 * @param {() => Date} now
 * @returns {Promise<number>} number of entries requeued
 */
async function requeueDeferredForSession(projectRoot, sessionId, now) {
  if (!sessionId) return 0;
  const all = await readEntries(projectRoot);
  const toRequeue = all.filter((e) => {
    if (e.status !== 'deferredUntilSession') return false;
    const s = typeof e.sessionId === 'string' ? e.sessionId : '';
    return s !== '' && s !== sessionId;
  });
  if (toRequeue.length === 0) return 0;
  const at = now().toISOString().replace(/\.\d{3}Z$/, 'Z');
  for (const e of toRequeue) {
    await appendState(projectRoot, {
      id: e.id, at, status: 'pending',
    });
  }
  return toRequeue.length;
}

// -- discard ---------------------------------------------------------------

const DISCARD_OPTIONS = /** @type {const} */ ({
  all:  { type: 'boolean' },
  help: { type: 'boolean' },
});

async function handleDiscard(argv, ctx) {
  const { stdout, stderr, cwd } = ctx;
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: DISCARD_OPTIONS, allowPositionals: true, strict: true });
  } catch (err) {
    stderr.write(`[error] usage ${err.message}\n`);
    return 2;
  }
  const flags = parsed.values;
  if (flags.help) { stdout.write(HELP); return 0; }

  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    stderr.write('[error] usage no project root found (no rcf/manifest.json in this directory or any ancestor).\n');
    return 2;
  }
  const all = await readEntries(projectRoot);
  // F-slice-1-11: design 3.1 L137 allows discard against any id, not
  // only pending. A user changing their mind about a deferred or a
  // bundled entry must be able to say so. Only already-discarded /
  // pruned entries are refused (idempotency).
  const active = all.filter((e) => e.status !== 'discarded' && e.status !== 'pruned');
  const pending = all.filter((e) => e.status === 'pending');
  let targets;
  if (flags.all) {
    if (parsed.positionals.length > 0) {
      stderr.write('[error] usage --all cannot be combined with entry ids\n');
      return 2;
    }
    // `--all` (kept scope: pending only) matches slice-1 semantics
    // so a hook-triggered mass discard does not accidentally nuke
    // submitted issue links.
    targets = pending;
  } else {
    if (parsed.positionals.length === 0) {
      stderr.write('[error] usage discard: at least one entry id, or --all\n');
      return 2;
    }
    const wanted = new Set(parsed.positionals);
    const byId = new Map(active.map((e) => [e.id, e]));
    targets = [];
    const missing = [];
    for (const id of wanted) {
      const e = byId.get(id);
      if (!e) { missing.push(id); continue; }
      targets.push(e);
    }
    if (missing.length > 0) {
      stderr.write(`[error] usage unknown entry id(s): ${missing.join(', ')}\n`);
      return 2;
    }
  }
  if (targets.length === 0) {
    stdout.write('no feedback entries to discard.\n');
    return 0;
  }
  const at = ctx.now().toISOString().replace(/\.\d{3}Z$/, 'Z');
  for (const e of targets) {
    await appendState(projectRoot, { id: e.id, at, status: 'discarded' });
  }
  stdout.write(`discarded ${targets.length} entr${targets.length === 1 ? 'y' : 'ies'}.\n`);
  return 0;
}

// -- preview (slice 2, FBS-181) -------------------------------------------

const PREVIEW_OPTIONS = /** @type {const} */ ({
  json: { type: 'boolean' },
  help: { type: 'boolean' },
});

/**
 * Render each named (or every pending) entry as the title and body it
 * would take on the GitHub issue tracker, plus a redaction disclosure
 * ledger and any residual-secret markers rule 8b turned up. This is
 * what the operator sees before consenting to submit; it is read-only
 * and never touches the network.
 *
 * Text output: one framed block per entry with the destination line,
 * the rendered title, the rendered body inside a `---` fence, and the
 * ledger printed as diff-style `- before / + after (rule, count)`
 * rows. `--json` emits the same as one object per entry.
 *
 * @param {string[]} argv
 * @param {object} ctx
 * @returns {Promise<number>}
 */
async function handlePreview(argv, ctx) {
  const { stdout, stderr, cwd } = ctx;
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: PREVIEW_OPTIONS, allowPositionals: true, strict: true });
  } catch (err) {
    stderr.write(`[error] usage ${err.message}\n`);
    return 2;
  }
  const flags = parsed.values;
  if (flags.help) { stdout.write(HELP); return 0; }

  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    stderr.write('[error] usage no project root found (no rcf/manifest.json in this directory or any ancestor).\n');
    return 2;
  }

  const all = await readEntries(projectRoot);
  const pending = all.filter((e) => e.status === 'pending');
  const wantedIds = new Set(parsed.positionals);
  const entries = wantedIds.size > 0
    ? pending.filter((e) => wantedIds.has(e.id))
    : pending;

  if (wantedIds.size > 0) {
    const missing = [...wantedIds].filter((id) => !pending.some((e) => e.id === id));
    if (missing.length > 0) {
      stderr.write(`[error] usage unknown pending entry id(s): ${missing.join(', ')}\n`);
      return 2;
    }
  }

  const context = await buildRedactionContext(projectRoot);
  const resolverInputs = await loadResolverInputs(projectRoot);

  const previews = await Promise.all(
    entries.map((e) => buildPreview(e, context, resolverInputs)),
  );

  if (flags.json) {
    stdout.write(`${JSON.stringify(previews, null, 2)}\n`);
    return 0;
  }

  if (previews.length === 0) {
    stdout.write('no pending feedback entries to preview.\n');
    return 0;
  }

  for (const p of previews) {
    stdout.write(`--- ${p.id} ---\n`);
    // F-slice-3-03: preview must show derived-source disclosure and
    // the unresolved-library bundle message, not just repo + visibility.
    stdout.write(`destination: ${p.destination.repo ?? '(unresolved)'} (${p.destination.visibility})\n`);
    if (p.destination.derived === true) {
      stdout.write("  source: derived from the library's git source (no explicit issues field on the library)\n");
    } else if (p.destination.source) {
      stdout.write(`  source: ${p.destination.source}\n`);
    }
    if (p.destination.visibility === 'unresolved') {
      const reason = p.destination.reason ?? 'unresolved';
      const contact = p.destination.publisherContact ? ` (library contact: ${p.destination.publisherContact})` : '';
      stdout.write(`  no issue destination declared${p.destination.reason ? ` (${reason})` : ''}; bundle will be written${contact}\n`);
      // AC-15801-4 / design amendment R5b: for ambiguous-library-slug
      // surface the candidate library prefixes so the operator sees
      // exactly which qualified refs would resolve it.
      if (Array.isArray(p.destination.candidates) && p.destination.candidates.length > 0) {
        const qualified = p.destination.candidates.map((prefix) => `${prefix}:<slug>`).join(', ');
        stdout.write(`  candidate libraries owning this slug: ${p.destination.candidates.join(', ')} (re-apply with a qualified ref, e.g. ${qualified})\n`);
      }
    }
    stdout.write(`fingerprint: ${p.fingerprint}\n`);
    if (p.fingerprintFallback) {
      stdout.write('warning: no anchor on this entry; the fingerprint falls back to normalised-title tokens and duplicates may not fold.\n');
    }
    stdout.write(`title: ${p.titleRendered}\n`);
    stdout.write('body:\n');
    stdout.write('---\n');
    stdout.write(`${p.bodyRendered}\n`);
    stdout.write('---\n');
    if (p.ledger.length === 0) {
      stdout.write('redaction ledger: nothing replaced.\n');
    } else {
      stdout.write('redaction ledger:\n');
      for (const row of p.ledger) {
        stdout.write(`  - ${row.before}\n`);
        stdout.write(`  + ${row.after}   (${row.rule}, x${row.count})\n`);
      }
    }
    if (p.residual.length > 0) {
      stdout.write('residual secret markers (submit will refuse):\n');
      for (const r of p.residual) {
        stdout.write(`  residual secret at line ${r.line}: ${r.snippet}   (${r.pattern})\n`);
      }
    }
    stdout.write('\n');
  }
  return 0;
}

/**
 * Assemble the redaction context from the project's identity seed and
 * manifest. Best-effort: a missing file leaves that field undefined
 * rather than failing the preview.
 *
 * @param {string} projectRoot
 * @returns {Promise<import('../feedback/redact.js').RedactionContext>}
 */
async function buildRedactionContext(projectRoot) {
  let operatorName;
  try {
    const profile = await readFile(resolve(projectRoot, 'rcf', '.identity', 'profile.md'), 'utf8');
    const m = profile.match(/^##\s+Name\s*\n([^\n]+)/m);
    if (m) {
      const n = m[1].trim();
      if (n && !/placeholder|todo|your name/i.test(n)) operatorName = n;
    }
  } catch { /* absent is fine */ }

  let projectName;
  const remotes = new Set();
  try {
    const manifest = JSON.parse(await readFile(resolve(projectRoot, 'rcf', 'manifest.json'), 'utf8'));
    if (typeof manifest.projectName === 'string') projectName = manifest.projectName;
    if (typeof manifest.gitRemote === 'string') remotes.add(manifest.gitRemote);
  } catch { /* absent is fine */ }

  // F-slice-2-07: also walk `git remote -v` so ordinary projects
  // without a manifest.gitRemote still have their HTTPS remote
  // redacted. Best-effort; a missing git or a non-repo directory
  // just leaves the set unchanged.
  try {
    const { stdout } = await execFileP('git', ['-C', projectRoot, 'remote', '-v'], { encoding: 'utf8' });
    for (const line of stdout.split('\n')) {
      const parts = line.split(/\s+/);
      if (parts.length >= 2 && parts[1]) remotes.add(parts[1]);
    }
  } catch { /* no git or no remotes is fine */ }

  let allowHostsExt = [];
  try {
    const settings = JSON.parse(await readFile(resolve(projectRoot, 'rcf', 'feedback-settings.json'), 'utf8'));
    if (Array.isArray(settings?.redaction?.allowHosts)) {
      allowHostsExt = settings.redaction.allowHosts;
    }
  } catch { /* absent is fine */ }
  // Assemble the extended allow-list once so downstream callers can
  // print it if they want to; the redactor itself accepts the raw
  // extension array.
  void allowedHosts;

  // F-slice-2-06: pass BOTH the typed spelling and the realpath
  // spelling of the project root so a path expressed either way
  // (e.g. /tmp/foo vs /private/tmp/foo on macOS) is stripped.
  const rootSpellings = [projectRoot];
  try {
    const real = await realpath(projectRoot);
    if (real && real !== projectRoot) rootSpellings.push(real);
  } catch { /* absent is fine */ }

  return {
    projectRoot: rootSpellings,
    projectName,
    operatorName,
    gitRemote: [...remotes].filter((r) => typeof r === 'string' && r.length > 0),
    allowHosts: allowHostsExt,
  };
}

/**
 * Load the resolver's read-only inputs (manifest, registry) once per
 * preview call so a batch of entries all consult the same on-disk
 * state. Best-effort: a missing manifest or registry file falls back
 * to empty shapes, which the resolver treats as "unresolved" for
 * blueprint entries and "core" for core entries.
 *
 * @param {string} projectRoot
 * @returns {Promise<{ manifest: object | null, registry: object | null }>}
 */
async function loadResolverInputs(projectRoot) {
  let manifest = null;
  try {
    const raw = await readFile(resolve(projectRoot, 'rcf', 'manifest.json'), 'utf8');
    manifest = JSON.parse(raw);
  } catch { /* absent is fine */ }
  const registry = await readLibraryRegistry(projectRoot);
  // readLibraryRegistry returns an rcfError object on parse failure;
  // preview should not blow up on a broken registry. Treat that shape
  // as "no registry", so blueprint entries fall through to unresolved
  // rather than crashing.
  const usableRegistry = (registry && typeof registry === 'object' && 'kind' in registry)
    ? { libraries: [] }
    : registry;
  return { manifest, registry: usableRegistry };
}

/**
 * Build one preview record for `--json` output and for the text
 * renderer. Uses the destination resolver (slice 3) so the destination
 * shape now matches the design 3.3 walk.
 *
 * @param {object} entry
 * @param {import('../feedback/redact.js').RedactionContext} context
 * @param {{ manifest: object | null, registry: object | null }} resolverInputs
 * @returns {Promise<object>}
 */
async function buildPreview(entry, context, resolverInputs) {
  const titleRes = redact(entry.title ?? '', context);
  const bodyRes = redact(entry.body ?? '', context);
  const evidenceRedacted = (entry.evidence ?? []).map((ev) => {
    const r = redact(ev.value ?? '', context);
    return { kind: ev.kind, value: r.text, ledger: r.ledger };
  });
  const combinedLedger = mergeLedger([titleRes.ledger, bodyRes.ledger, ...evidenceRedacted.map((e) => e.ledger)]);
  const fp = fingerprint(entry);
  const destination = await resolveDestination(entry, resolverInputs);
  const rendered = renderIssue(entry, {
    title: titleRes.text,
    body: bodyRes.text,
    evidence: evidenceRedacted.map((e) => ({ kind: e.kind, value: e.value })),
    ledger: combinedLedger,
  }, { fingerprint: fp, destination });
  // F-slice-2-08: preview must run the residual pass over the
  // RENDERED body (which inlines evidence values) so an evidence
  // pointer carrying a residual secret is called out at preview
  // time, not silently landed in the issue. Also merge evidence
  // residuals from the per-field pass so the operator sees where
  // each hit came from.
  const evidenceResidual = evidenceRedacted.flatMap((e) => findResidualSecrets(String(e.value ?? '')));
  const renderedResidual = findResidualSecrets(rendered.body);
  const residual = dedupeResidual([
    ...titleRes.residual,
    ...bodyRes.residual,
    ...evidenceResidual,
    ...renderedResidual,
  ]);
  return {
    id: entry.id,
    fingerprint: fp,
    fingerprintFallback: entry.anchor == null || String(entry.anchor).trim() === '',
    destination,
    titleRendered: rendered.title,
    bodyRendered: rendered.body,
    labels: rendered.labels,
    ledger: combinedLedger,
    residual,
  };
}

/**
 * Dedupe residual-hit rows on (pattern, line, snippet) so a hit found
 * both in an evidence pass and again in the rendered body does not
 * double-count in the preview surface.
 *
 * @param {Array<{line: number, snippet: string, pattern: string}>} hits
 */
function dedupeResidual(hits) {
  const seen = new Set();
  const out = [];
  for (const h of hits) {
    const key = `${h.pattern}|${h.line}|${h.snippet}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  return out;
}

/**
 * Fold ledgers from several redact() calls into one. Rows are grouped
 * by (rule, before) so distinct samples of the same rule survive the
 * merge into the preview surface (F-slice-2-09): the redactor already
 * keeps one row per distinct before-sample; if this fold then collapsed
 * everything under a rule name to a single row, the operator would see
 * only one out of many stripped values. Counts sum within a (rule,
 * before) group. Ordering is first-seen so the preview reads in the
 * order rules fired.
 *
 * @param {Array<Array<{ rule: string, before: string, after: string, count: number }>>} ledgers
 * @returns {Array<{ rule: string, before: string, after: string, count: number }>}
 */
function mergeLedger(ledgers) {
  const byKey = new Map();
  const order = [];
  for (const ledger of ledgers) {
    for (const row of ledger) {
      const key = `${row.rule}|${row.before}`;
      if (!byKey.has(key)) {
        order.push(key);
        byKey.set(key, { rule: row.rule, before: row.before, after: row.after, count: row.count });
      } else {
        byKey.get(key).count += row.count;
      }
    }
  }
  return order.map((k) => byKey.get(k));
}

// -- submit (slice 4, FBS-183) --------------------------------------------

const SUBMIT_OPTIONS = /** @type {const} */ ({
  yes: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  'no-preview': { type: 'boolean' },
  help: { type: 'boolean' },
});

/**
 * `rcf feedback submit`: file each pending entry (or those named by
 * positional id) under the reporter's ambient gh login. Refuses
 * without `--yes` on a non-TTY (design section 9's consent contract);
 * on a TTY the sub-verb prompts once. `--dry-run` runs the preflight
 * and dedupe search and prints the plan without any create/comment.
 *
 * Preflight order (per destination): gh on PATH -> gh auth status ->
 * gh repo view (visibility + viewerPermission + hasIssuesEnabled).
 * First failure routes that destination's entries to a bundle. The
 * unresolved-destination case (destination.resolve returned unresolved)
 * bundles directly with no gh calls for those entries (AC-16001-4).
 *
 * Dedupe (per entry passing preflight): gh search issues on the
 * destination for `rcf-feedback-fingerprint: <fp>` (open, in:body,
 * limit 5). Every returned candidate is then re-read via
 * ghIssueGetBody, and only candidates whose body carries
 * `rcf-feedback-fingerprint: <fp>` on its own line AND whose anchor /
 * kind / target markers do not disagree with the entry's are counted
 * as verified matches (0.28.2, issue #234, Barry ruling 2026-09-21).
 * A search hit that does not verify is a NON-MATCH and is dropped
 * before the fold decision. Zero verified hits -> create; one -> fold
 * comment on that number; many -> fold on the lowest and mention the
 * others. The fold comment carries the full report (title, body,
 * evidence, environment) prefaced with "Apparent duplicate of the
 * issue subject; posting the full report so a human can judge." The
 * retired "+1 from another reporter." payload is gone. Search
 * failure -> create with dedupe:unchecked. Closed search runs only
 * after a zero-hit open search so the create body can reference the
 * prior number.
 *
 * Create/comment failure (network/4xx/5xx/ratelimit or unexpected
 * label rejection): retry once WITHOUT labels; still failing, bundle
 * that entry only. Exit 0 when every entry ended submitted or
 * bundled; exit 3 when a residual secret leaves one pending.
 *
 * @param {string[]} argv
 * @param {object} ctx
 * @returns {Promise<number>}
 */
async function handleSubmit(argv, ctx) {
  const { stdout, stderr, cwd, env, now, sessionId } = ctx;
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: SUBMIT_OPTIONS, allowPositionals: true, strict: true });
  } catch (err) {
    stderr.write(`[error] usage ${err.message}\n`);
    return 2;
  }
  const flags = parsed.values;
  if (flags.help) { stdout.write(HELP); return 0; }

  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    stderr.write('[error] usage no project root found (no rcf/manifest.json in this directory or any ancestor).\n');
    return 2;
  }

  // Consent gate: --yes is required unless stdin is a TTY and the
  // user answers y. In practice the agent always passes --yes after
  // the operator said yes in conversation; the flag is the contract
  // that a human answered. AC-15901-2 asserts the non-TTY branch.
  if (!flags.yes) {
    const stdin = process.stdin;
    const isTty = typeof stdin?.isTTY === 'boolean' ? stdin.isTTY : false;
    if (!isTty) {
      stderr.write('[error] usage rcf feedback submit requires --yes (or an interactive TTY where you can confirm the send).\n');
      return 2;
    }
    const ok = await promptForYes(stdin, stdout);
    if (!ok) {
      stdout.write('submit cancelled.\n');
      return 0;
    }
  }

  const all = await readEntries(projectRoot);
  const pending = all.filter((e) => e.status === 'pending');
  const wantedIds = new Set(parsed.positionals);
  const entries = wantedIds.size > 0
    ? pending.filter((e) => wantedIds.has(e.id))
    : pending;

  if (wantedIds.size > 0) {
    const missing = [...wantedIds].filter((id) => !pending.some((e) => e.id === id));
    if (missing.length > 0) {
      stderr.write(`[error] usage unknown pending entry id(s): ${missing.join(', ')}\n`);
      return 2;
    }
  }

  if (entries.length === 0) {
    stdout.write('no pending feedback entries to submit.\n');
    return 0;
  }

  const context = await buildRedactionContext(projectRoot);
  const resolverInputs = await loadResolverInputs(projectRoot);
  const gh = await loadGhAdapter(env);
  const rcfLiteVersion = await readOwnVersion();

  // Group entries by destination repo so the preflight (auth,
  // repo-view, label-list) runs once per repo, not once per entry.
  // Unresolved destinations get their own bucket so the case-5 path
  // (AC-16001-4) is a first-class fold, not a special-case.
  const buckets = new Map();
  for (const e of entries) {
    const destination = await resolveDestination(e, resolverInputs);
    const key = destination.repo ?? `__unresolved__:${destination.reason ?? 'unknown'}`;
    if (!buckets.has(key)) buckets.set(key, { destination, entries: [] });
    buckets.get(key).entries.push(e);
  }

  // Preflight once per bucket; per-destination results feed the
  // per-entry submit loop.
  const preflightCache = new Map();
  for (const [key, bucket] of buckets) {
    if (bucket.destination.visibility === 'unresolved') {
      preflightCache.set(key, { ok: false, reason: 'unresolved-destination', bucket: true });
    } else {
      preflightCache.set(key, await runPreflight(bucket.destination, gh));
    }
  }

  const summary = {
    submitted: 0,
    bundled: 0,
    pending: 0,
  };
  const bundleRowsByKey = new Map();

  for (const [key, bucket] of buckets) {
    const destination = bucket.destination;
    const pre = preflightCache.get(key);

    if (!pre.ok && pre.bucket === true) {
      // Whole-destination fallback: build one bundle file for every
      // entry in this bucket; the message is the preflight reason.
      const rows = [];
      for (const e of bucket.entries) {
        const built = await buildEntryPayload(e, context, rcfLiteVersion);
        if (built.residual.length > 0) {
          await markResidual(projectRoot, e.id, at(now), sessionId);
          stdout.write(`${e.id} -> pending (residual secret in body; run \`rcf feedback preview\` and rewrite)\n`);
          summary.pending += 1;
          continue;
        }
        rows.push({ entry: e, redacted: built.redacted, fingerprint: built.fingerprint });
      }
      if (rows.length > 0) {
        bundleRowsByKey.set(key, { destination, rows, reason: pre.message });
      }
      continue;
    }

    for (const e of bucket.entries) {
      const built = await buildEntryPayload(e, context, rcfLiteVersion);
      if (built.residual.length > 0) {
        await markResidual(projectRoot, e.id, at(now), sessionId);
        stdout.write(`${e.id} -> pending (residual secret in body; run \`rcf feedback preview\` and rewrite)\n`);
        summary.pending += 1;
        continue;
      }

      // Label pre-check per entry-repo pair. Cached on the preflight
      // record so the second entry against the same repo does not
      // re-list.
      if (!pre.labelsChecked) {
        pre.labels = await runLabelPrecheck(destination.repo, gh);
        pre.labelsChecked = true;
      }
      const requestedLabels = labelsForEntry(e.severity, e.kind);
      const availableLabels = pre.labels?.available ?? null;
      const usedLabels = availableLabels
        ? requestedLabels.filter((l) => availableLabels.includes(l))
        : requestedLabels;
      const droppedLabels = availableLabels
        ? requestedLabels.filter((l) => !availableLabels.includes(l))
        : [];

      // Dedupe search on the destination (open first).
      const searchOpen = await gh.ghIssueSearch({
        repo: destination.repo,
        query: `rcf-feedback-fingerprint: ${built.fingerprint}`,
        state: 'open',
        limit: 5,
      });

      let dedupe = 'new';
      let closedRef = null;
      let matches = [];
      let searchMatches = [];
      if (!searchOpen.ok) {
        dedupe = 'unchecked';
      } else {
        searchMatches = searchOpen.value?.matches ?? [];
      }

      // 0.28.2 (issue #234, Barry ruling 2026-09-21): the search hit
      // alone is not a fold decision. Re-read each candidate body via
      // ghIssueGetBody and keep only those whose body carries
      // `rcf-feedback-fingerprint: <fp>` on its own line AND whose
      // anchor / kind / target markers do not disagree with the
      // entry's. A search hit whose body does not verify is a
      // NON-MATCH and is dropped before the fold decision.
      if (searchMatches.length > 0 && typeof gh.ghIssueGetBody === 'function') {
        const verified = [];
        for (const m of searchMatches) {
          const v = await gh.ghIssueGetBody({ repo: destination.repo, number: m.number });
          if (!v.ok || typeof v.value?.body !== 'string') continue;
          const body = v.value.body;
          if (!hasFingerprintLine(body, built.fingerprint)) continue;
          if (!candidateMatchesEntry(body, e)) continue;
          verified.push({ ...m, title: m.title ?? extractTitle(body) ?? null });
        }
        matches = verified;
      } else {
        matches = searchMatches;
      }

      if (flags['dry-run']) {
        const plan = matches.length === 1
          ? `commented on #${matches[0].number} (fingerprint match${matches[0].title ? `: ${matches[0].title}` : ''})`
          : matches.length > 1
            ? `commented on #${matches.slice().sort((a, b) => a.number - b.number)[0].number} (fingerprint match, ${matches.length} verified)`
            : 'created';
        stdout.write(`${e.id} -> dry-run ${plan} (${dedupe === 'unchecked' ? 'unchecked' : matches.length === 0 ? 'new' : 'comment'})\n`);
        continue;
      }

      // Zero-open-hit case: check closed-hit so the create body can
      // reference the previously reported number.
      if (matches.length === 0 && dedupe !== 'unchecked') {
        const searchClosed = await gh.ghIssueSearch({
          repo: destination.repo,
          query: `rcf-feedback-fingerprint: ${built.fingerprint}`,
          state: 'closed',
          limit: 1,
        });
        if (searchClosed.ok && (searchClosed.value?.matches ?? []).length > 0) {
          closedRef = searchClosed.value.matches[0].number;
        }
      }

      let result;
      if (matches.length === 0) {
        // Create.
        let createBody = built.rendered.body;
        if (closedRef) {
          createBody = `${createBody}\nPreviously reported and closed as #${closedRef}.\n`;
        }
        result = await createWithRetry(gh, {
          repo: destination.repo,
          title: built.rendered.title,
          body: createBody,
          labels: usedLabels,
        });
      } else if (matches.length === 1) {
        // Verified fingerprint match: comment. Comment carries the
        // full report per Barry's 2026-09-21 ruling on #234.
        dedupe = 'comment';
        const commentBody = renderComment(e, built.redacted, {
          fingerprint: built.fingerprint,
          matchedTitle: matches[0].title ?? null,
        }).body;
        result = await commentWithRetry(gh, {
          repo: destination.repo,
          number: matches[0].number,
          body: commentBody,
        });
      } else {
        // Many verified matches: comment on lowest, mention the
        // others. The comment still carries the full report.
        dedupe = 'comment';
        const sorted = matches.slice().sort((a, b) => a.number - b.number);
        const others = sorted.slice(1).map((m) => `#${m.number}`).join(', ');
        const base = renderComment(e, built.redacted, {
          fingerprint: built.fingerprint,
          matchedTitle: sorted[0].title ?? null,
        }).body;
        const commentBody = `${base}\nalso see ${others}\n`;
        result = await commentWithRetry(gh, {
          repo: destination.repo,
          number: sorted[0].number,
          body: commentBody,
        });
      }

      if (result.ok) {
        await appendState(projectRoot, {
          id: e.id,
          at: at(now),
          status: 'submitted',
          issueUrl: result.url,
          dedupe,
          droppedLabels,
          sessionId,
        });
        // 0.28.2 (issue #234): row shape names the outcome and the
        // matched issue's title so a wrong fold is visible on the
        // same line a human already sees.
        const number = extractIssueNumberFromUrl(result.url);
        const numberSuffix = number ? `#${number}` : '';
        if (dedupe === 'comment') {
          const sorted = matches.slice().sort((a, b) => a.number - b.number);
          const matchedTitle = sorted[0]?.title ?? null;
          const foldTail = matchedTitle ? `: ${matchedTitle}` : '';
          stdout.write(`${e.id} -> commented on ${numberSuffix} (fingerprint match${foldTail}) ${result.url}\n`);
        } else if (dedupe === 'unchecked') {
          stdout.write(`${e.id} -> created ${numberSuffix} (dedupe unchecked) ${result.url}\n`);
        } else {
          stdout.write(`${e.id} -> created ${numberSuffix} ${result.url}\n`);
        }
        summary.submitted += 1;
      } else {
        // Retry-without-labels failed too: bundle this one entry.
        const rows = bundleRowsByKey.get(`__perentry__:${e.id}`)?.rows ?? [];
        rows.push({ entry: e, redacted: built.redacted, fingerprint: built.fingerprint });
        bundleRowsByKey.set(`__perentry__:${e.id}`, {
          destination,
          rows,
          reason: `create/comment failed: ${result.reason}`,
        });
      }
    }
  }

  // Write bundle files (whole-destination and per-entry).
  const generatedAt = now().toISOString().replace(/\.\d{3}Z$/, 'Z');
  for (const [key, bundle] of bundleRowsByKey) {
    // Round 4 (F-01, design R3c): `submit --dry-run` writes nothing
    // under `.rcf/feedback/`, including outbox bundles for the
    // unresolved-destination and whole-destination-fallback branches.
    // Previously the dry-run gate on the create/comment path (L1340)
    // let the bundle write path run unconditionally, so an
    // `unresolved` entry produced a real outbox file on a dry-run.
    if (flags['dry-run']) {
      const issuesUrl = bundle.destination.repo
        ? `https://github.com/${bundle.destination.repo}/issues/new`
        : '(no repo; paste to the library owner)';
      const contactLine = bundle.destination.publisherContact
        ? ` (contact: ${bundle.destination.publisherContact})`
        : '';
      stdout.write(`${bundle.rows.map((r) => r.entry.id).join(', ')} -> dry-run bundle ${issuesUrl}${contactLine}\n`);
      continue;
    }
    let outboxPath;
    try {
      outboxPath = await writeBundle(projectRoot, bundle.destination, bundle.rows, {
        generatedAt,
        rcfLiteVersion,
        reasonNotFiled: bundle.reason,
      });
    } catch (err) {
      // Round 3 (AC-15601-4 regression): writeBundle throws
      // FEEDBACK_BUNDLE_RESIDUAL when the safeguard's whole-bundle
      // residual scan bites. The uncaught throw propagated all the
      // way to the dispatcher and turned the exit code into 1; the
      // documented shape is exit 3 (at least one entry pending),
      // matching the per-entry residual path. Catch it here, keep
      // every bundle row PENDING with residual:true, and let
      // `summary.pending > 0 ? 3 : 0` return the 3.
      if (/** @type {any} */ (err)?.code === 'FEEDBACK_BUNDLE_RESIDUAL') {
        stdout.write(`${bundle.rows.map((r) => r.entry.id).join(', ')} -> pending (bundle-level residual secret; run \`rcf feedback preview\` and rewrite before submit)\n`);
        stderr.write(`[safeguard] ${err.message}\n`);
        for (const row of bundle.rows) {
          await markResidual(projectRoot, row.entry.id, at(now), sessionId);
          summary.pending += 1;
        }
        continue;
      }
      throw err;
    }
    const issuesUrl = bundle.destination.repo
      ? `https://github.com/${bundle.destination.repo}/issues/new`
      : '(no repo; paste to the library owner)';
    const contactLine = bundle.destination.publisherContact
      ? ` (contact: ${bundle.destination.publisherContact})`
      : '';
    stdout.write(`${bundle.rows.map((r) => r.entry.id).join(', ')} -> bundle ${outboxPath} | ${issuesUrl}${contactLine}\n`);
    for (const row of bundle.rows) {
      await appendState(projectRoot, {
        id: row.entry.id,
        at: at(now),
        status: 'bundled',
        outboxPath,
        reason: bundle.reason,
        sessionId,
      });
      summary.bundled += 1;
    }
  }

  return summary.pending > 0 ? 3 : 0;
}

/**
 * Read up to a single line of yes/no from stdin (blocking one-shot).
 * Returns true only for `y` or `yes` (case-insensitive).
 *
 * @param {NodeJS.ReadStream} stdin
 * @param {NodeJS.WritableStream} stdout
 * @returns {Promise<boolean>}
 */
async function promptForYes(stdin, stdout) {
  stdout.write('submit each pending entry under your ambient gh login? [y/N] ');
  return new Promise((resolvePromise) => {
    let buf = '';
    const onData = (chunk) => {
      buf += chunk.toString('utf8');
      const nl = buf.indexOf('\n');
      if (nl >= 0) {
        stdin.off('data', onData);
        try { stdin.pause(); } catch { /* ignore */ }
        const answer = buf.slice(0, nl).trim().toLowerCase();
        resolvePromise(answer === 'y' || answer === 'yes');
      }
    };
    stdin.on('data', onData);
    try { stdin.resume(); } catch { /* ignore */ }
  });
}

/**
 * Build the redacted body/title and the rendered issue payload for
 * one entry. Records residual-secret markers on the returned object
 * so the caller can refuse the entry.
 *
 * @param {object} entry
 * @param {import('../feedback/redact.js').RedactionContext} context
 * @param {string} rcfLiteVersion
 */
async function buildEntryPayload(entry, context, rcfLiteVersion) {
  const titleRes = redact(entry.title ?? '', context);
  const bodyRes = redact(entry.body ?? '', context);
  const evidenceRedacted = (entry.evidence ?? []).map((ev) => {
    const r = redact(ev.value ?? '', context);
    return { kind: ev.kind, value: r.text, ledger: r.ledger };
  });
  const ledger = mergeLedger([titleRes.ledger, bodyRes.ledger, ...evidenceRedacted.map((e) => e.ledger)]);
  const fp = fingerprint(entry);
  // A destination shape the render helper accepts; the submit path
  // does not use bundle-specific fields on rendered issues.
  const rendered = renderIssue(entry, {
    title: titleRes.text,
    body: bodyRes.text,
    evidence: evidenceRedacted.map((e) => ({ kind: e.kind, value: e.value })),
    ledger,
  }, { fingerprint: fp, destination: { repo: null, visibility: 'unresolved' } });
  const residual = [
    ...titleRes.residual,
    ...bodyRes.residual,
    ...findResidualSecrets(rendered.body),
  ];
  void rcfLiteVersion;
  return {
    fingerprint: fp,
    redacted: {
      title: titleRes.text,
      body: bodyRes.text,
      evidence: evidenceRedacted.map((e) => ({ kind: e.kind, value: e.value })),
      ledger,
    },
    rendered,
    residual,
  };
}

/**
 * Preflight one destination repo. Records the classified reason on
 * failure so the bundle message can name it.
 *
 * @param {object} destination
 * @param {import('../feedback/gh.js').GhAdapter} gh
 */
async function runPreflight(destination, gh) {
  // (1) gh on PATH.
  const path = await gh.ghOnPath();
  if (!path.ok || (path.ok && path.value?.present === false)) {
    return {
      ok: false,
      bucket: true,
      reason: 'gh-missing',
      message: 'gh not on PATH; install from https://cli.github.com',
    };
  }
  // (2) gh auth status.
  const auth = await gh.ghAuthStatus({ host: 'github.com' });
  if (!auth.ok) {
    return {
      ok: false,
      bucket: true,
      reason: 'gh-auth',
      message: 'gh is not logged in; run `gh auth login`',
    };
  }
  // (3) repo access, visibility, hasIssuesEnabled.
  const view = await gh.ghRepoView({ repo: destination.repo });
  if (!view.ok) {
    return {
      ok: false,
      bucket: true,
      reason: 'repo-unreachable',
      message: `cannot reach ${destination.repo}: ${view.message}`,
    };
  }
  const v = view.value;
  const isPrivate = (v?.visibility && String(v.visibility).toLowerCase() === 'private')
    || destination.visibility === 'private';
  if (isPrivate && (v?.viewerPermission === null || v?.viewerPermission === undefined || String(v.viewerPermission).toUpperCase() === 'NONE')) {
    const contact = destination.publisherContact ? ` (library contact: ${destination.publisherContact})` : '';
    return {
      ok: false,
      bucket: true,
      reason: 'private-no-access',
      message: `no access to private repo ${destination.repo}${contact}`,
    };
  }
  if (v?.hasIssuesEnabled === false) {
    return {
      ok: false,
      bucket: true,
      reason: 'issues-disabled',
      message: `issues are disabled on ${destination.repo}`,
    };
  }
  return { ok: true, view: v };
}

/**
 * Label pre-check: list labels on the destination once and cache the
 * `available` set of the requested six (any not-present label is
 * dropped). A gh label list failure returns null available so the
 * submit path proceeds with the requested labels (best-effort per
 * design section 4.3 note).
 *
 * @param {string} repo
 * @param {import('../feedback/gh.js').GhAdapter} gh
 */
async function runLabelPrecheck(repo, gh) {
  const r = await gh.ghLabelList({ repo });
  if (!r.ok) return { available: null };
  const names = r.value?.names ?? [];
  return { available: names };
}

async function createWithRetry(gh, opts) {
  const first = await gh.ghIssueCreate(opts);
  if (first.ok) return { ok: true, url: first.value.url, number: first.value.number };
  // Retry once without labels.
  const second = await gh.ghIssueCreate({ ...opts, labels: [] });
  if (second.ok) return { ok: true, url: second.value.url, number: second.value.number };
  return { ok: false, reason: second.message };
}

async function commentWithRetry(gh, opts) {
  const first = await gh.ghIssueComment(opts);
  if (first.ok) return { ok: true, url: first.value.url };
  const second = await gh.ghIssueComment(opts);
  if (second.ok) return { ok: true, url: second.value.url };
  return { ok: false, reason: second.message };
}

/**
 * Write one bundle file under `.rcf/feedback/outbox/`. Filename shape:
 * `<ISO-timestamp>-<repo-slug>.md`; unresolved destinations use
 * `<ISO-timestamp>-unresolved.md`. Returns the absolute path.
 *
 * @param {string} projectRoot
 * @param {object} destination
 * @param {Array<{ entry: object, redacted: object, fingerprint: string }>} rows
 * @param {{ generatedAt: string, rcfLiteVersion: string, reasonNotFiled?: string }} meta
 * @returns {Promise<string>}
 */
async function writeBundle(projectRoot, destination, rows, meta) {
  const dir = outboxDir(projectRoot);
  await mkdir(dir, { recursive: true });
  const stampSafe = meta.generatedAt.replace(/[:]/g, '-');
  const slug = destination.repo
    ? destination.repo.replace(/[^A-Za-z0-9._-]+/g, '-').toLowerCase()
    : 'unresolved';
  // A per-entry fallback bundle (retry-then-fail) uses the entry id as
  // a disambiguator so two fallbacks in the same second do not
  // overwrite each other. A whole-destination bundle keeps the base
  // filename shape.
  const tail = rows.length === 1 ? `-${rows[0].entry.id}` : '';
  const filename = `${stampSafe}-${slug}${tail}.md`;
  const path = resolve(dir, filename);
  const bundleDestination = {
    repo: destination.repo,
    visibility: destination.visibility === 'private' ? 'private' : (destination.repo ? 'public' : 'unresolved'),
    reasonNotFiled: meta.reasonNotFiled,
    libraryContact: destination.publisherContact,
  };
  const text = renderBundle(bundleDestination, rows, {
    generatedAt: meta.generatedAt,
    rcfLiteVersion: meta.rcfLiteVersion,
  });
  // Design safeguard (fix round 2, AC-15601-4): a final whole-text
  // residual-secret pass over the fully assembled and normalised
  // bundle text. Each row's rendered body already passed the
  // per-entry check in buildEntryPayload, but the bundle is the
  // last surface before bytes hit disk; if renderBundle's header
  // or section framing somehow ever reintroduces a residual shape,
  // the write is refused with a fail-closed error rather than a
  // silent leak.
  const bundleResiduals = findResidualSecrets(text);
  if (bundleResiduals.length > 0) {
    const first = bundleResiduals[0];
    const err = new Error(
      `[safeguard] refusing to write bundle ${filename}: residual secret pattern ${first.pattern} at line ${first.line} (${bundleResiduals.length} hit${bundleResiduals.length === 1 ? '' : 's'}). `
      + 'This is a defence-in-depth refusal - the per-entry residual check already runs against each rendered body; a bundle-level hit means the bundle assembly re-introduced a shape and MUST be investigated before submit is re-run.',
    );
    /** @type {any} */ (err).code = 'FEEDBACK_BUNDLE_RESIDUAL';
    throw err;
  }
  await writeFile(path, text, 'utf8');
  return path;
}

/**
 * Stamp a residual-secret refusal on the entry state (kept pending).
 *
 * @param {string} projectRoot
 * @param {string} id
 * @param {string} atStamp
 * @param {string} sessionId
 */
async function markResidual(projectRoot, id, atStamp, sessionId) {
  await appendState(projectRoot, {
    id,
    at: atStamp,
    status: 'pending',
    residual: true,
    sessionId,
  });
}

function at(now) {
  return now().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// -- 0.28.2 (issue #234) fold-decision helpers ----------------------------
//
// A search hit alone is not a fold: submit re-reads the candidate
// body and folds only when the fingerprint line is literally present
// on its own line AND the anchor / kind / target markers do not
// contradict the entry's. This is the code side of Barry's ruling on
// #234 (2026-09-21) and of the amended AC-15701-2.

/**
 * True when `body` contains a line reading exactly
 * `rcf-feedback-fingerprint: <fp>` (case-sensitive, own line).
 *
 * @param {string} body
 * @param {string} fp
 * @returns {boolean}
 */
function hasFingerprintLine(body, fp) {
  if (typeof body !== 'string' || typeof fp !== 'string' || fp.length === 0) return false;
  const target = `rcf-feedback-fingerprint: ${fp}`;
  const lines = body.split(/\r?\n/);
  for (const l of lines) {
    if (l.trim() === target) return true;
  }
  return false;
}

/**
 * Defence-in-depth: with a truncated fingerprint (12 hex chars) a
 * collision is negligible but not zero. We refuse to fold when the
 * candidate body's environment-table markers for anchor, kind or the
 * blueprint slug disagree with the entry's own values.
 *
 * @param {string} body
 * @param {object} entry
 * @returns {boolean}
 */
function candidateMatchesEntry(body, entry) {
  if (typeof body !== 'string') return false;
  const marker = (label) => {
    const re = new RegExp(`\\|\\s*${label}\\s*\\|\\s*([^|\\n]+?)\\s*\\|`, 'i');
    const m = body.match(re);
    return m ? m[1].trim() : null;
  };
  const bodyAnchor = marker('anchor');
  const bodyKind = marker('kind');
  const bodyBlueprint = marker('blueprint');
  const entryAnchor = (entry?.anchor ?? '-').trim();
  const entryKind = (entry?.kind ?? 'core').trim();
  const entryBlueprintSlug = entry?.kind === 'blueprint'
    ? String(entry?.target?.effectiveSlug ?? entry?.target?.ref ?? '').trim()
    : null;
  if (bodyAnchor !== null && bodyAnchor.toUpperCase() !== entryAnchor.toUpperCase()) return false;
  if (bodyKind !== null && bodyKind.toLowerCase() !== entryKind.toLowerCase()) return false;
  if (entryBlueprintSlug && bodyBlueprint !== null) {
    // The blueprint cell carries the slug as its first whitespace-
    // separated token, followed by an optional version and library
    // trail. Compare only the head.
    const head = bodyBlueprint.split(/\s+/)[0];
    if (head && head !== entryBlueprintSlug) return false;
  }
  return true;
}

/**
 * Pull the first `## Report: <title>` header from a candidate body,
 * used to name the matched issue on the stdout row when the search
 * response did not carry one.
 *
 * @param {string} body
 * @returns {string | null}
 */
function extractTitle(body) {
  if (typeof body !== 'string') return null;
  const m = body.match(/^##\s+Report:\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

/**
 * Extract the numeric issue id from a github.com issue URL. Used only
 * to shape the stdout row.
 *
 * @param {string | undefined} url
 * @returns {number | null}
 */
function extractIssueNumberFromUrl(url) {
  if (typeof url !== 'string') return null;
  const m = url.match(/\/issues\/(\d+)/);
  return m ? Number(m[1]) : null;
}

// -- opt-in / opt-out (slice 5, FBS-184) ----------------------------------

const OPT_OPTIONS = /** @type {const} */ ({
  help: { type: 'boolean' },
  json: { type: 'boolean' },
});

/**
 * Toggle the per-project ask via `rcf/feedback-settings.json`.
 * `opt-out` writes `ask: false`; `opt-in` writes `ask: true`. Other
 * fields (settingsVersion, quietMinutes, redaction) survive the merge
 * (design section 8). The env-driven silences (RCF_FEEDBACK_ASK,
 * RCF_FEEDBACK_DISABLE) are complementary and never toggled here.
 *
 * @param {'opt-in' | 'opt-out'} which
 * @param {string[]} argv
 * @param {object} ctx
 */
async function handleOptToggle(which, argv, ctx) {
  const { stdout, stderr, cwd } = ctx;
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPT_OPTIONS, allowPositionals: false, strict: true });
  } catch (err) {
    stderr.write(`[error] usage ${err.message}\n`);
    return 2;
  }
  const flags = parsed.values;
  if (flags.help) { stdout.write(HELP); return 0; }

  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    stderr.write('[error] usage no project root found (no rcf/manifest.json in this directory or any ancestor).\n');
    return 2;
  }

  const ask = which === 'opt-in';
  const result = await writeFeedbackSettings(projectRoot, { ask });
  if (flags.json) {
    stdout.write(`${JSON.stringify({ action: result.action, path: 'rcf/feedback-settings.json', settings: result.settings }, null, 2)}\n`);
    return 0;
  }
  if (result.action === 'noop') {
    stdout.write(`feedback ${which}: no change (rcf/feedback-settings.json already has ask: ${ask}).\n`);
    return 0;
  }
  const verb = result.action === 'created' ? 'wrote' : 'updated';
  const posture = ask
    ? 'the harness will ask once per session at a natural pause (design 3.5).'
    : 'the harness will not ask on this project; add / preview / submit still work by hand.';
  stdout.write(`feedback ${which}: ${verb} rcf/feedback-settings.json (ask: ${ask}); ${posture}\n`);
  return 0;
}

// -- hook (slice 5, FBS-184) ---------------------------------------------

const HOOK_OPTIONS = /** @type {const} */ ({
  harness: { type: 'string' },
  help: { type: 'boolean' },
});

/**
 * Harness hook handler (design 3.5). Sub-shape:
 *   rcf feedback hook <stop|session-end|session-start> [--harness <h>]
 *
 * Reads harness JSON from stdin (session_id, cwd, hook_event_name,
 * stop_hook_active, last_assistant_message on Stop) and never blocks
 * longer than 1 second (the 1.5s SessionEnd shared budget on Claude
 * Code). The store IO is small; no network is ever touched.
 *
 * Behaviour by sub-verb:
 *   - stop: apply the quiet rule, and on 'ask' append the ledger
 *     record BEFORE emitting so a crash between emit and reply
 *     cannot cause a second ask; then emit per the harness.
 *   - session-end: write a bundle of every pending entry into
 *     `.rcf/feedback/outbox/`. Byte-idempotent: a re-run whose
 *     rendered payload matches the last-written bundle does not
 *     rewrite the file.
 *   - session-start: with pending entries carried over from a
 *     prior sessionId, print (or emit in the Codex shape) one
 *     context line so the harness re-surfaces the ask at the next
 *     natural pause (RULE 17). Never mutates state.json.
 *
 * @param {string[]} argv
 * @param {object} ctx
 */
async function handleHook(argv, ctx) {
  const { stdout, stderr, cwd, env, now, sessionId: fallbackSession } = ctx;
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    stdout.write(HELP);
    return argv.length === 0 ? 2 : 0;
  }
  const sub = argv[0];
  const rest = argv.slice(1);
  let parsed;
  try {
    parsed = parseArgs({ args: rest, options: HOOK_OPTIONS, allowPositionals: false, strict: true });
  } catch (err) {
    stderr.write(`[error] usage ${err.message}\n`);
    return 2;
  }
  const flags = parsed.values;
  if (flags.help) { stdout.write(HELP); return 0; }

  const harness = normaliseHarness(flags.harness, env);
  if (harness === 'unknown') {
    // The hook must always know which shape to emit; refuse rather
    // than guess. A missing --harness on a machine without either
    // env signature is a configuration bug in the installer.
    stderr.write("[error] usage --harness required (one of 'claude-code', 'codex') when neither CLAUDECODE nor CODEX_* env is set.\n");
    return 2;
  }
  if (!['stop', 'session-end', 'session-start'].includes(sub)) {
    stderr.write(`[error] usage unknown feedback hook sub-verb '${sub}' (expected stop, session-end, session-start).\n`);
    return 2;
  }

  const payload = await readHarnessPayload(ctx);
  const projectRootHint = typeof payload?.cwd === 'string' && payload.cwd.length > 0
    ? payload.cwd
    : cwd;
  const projectRoot = await findProjectRoot(projectRootHint);
  if (!projectRoot) {
    // No project root: silently exit 0 (a hook on a non-rcf tree
    // must never block or shout at the user; design 3.5 says the
    // hook is quiet by default).
    return 0;
  }

  const sessionIdIncoming = typeof payload?.session_id === 'string' && payload.session_id.length > 0
    ? payload.session_id
    : fallbackSession;

  if (sub === 'session-end') {
    return runSessionEndHook(projectRoot, { now });
  }
  if (sub === 'session-start') {
    return runSessionStartHook(projectRoot, harness, sessionIdIncoming, now, { stdout });
  }
  return runStopHook(projectRoot, harness, sessionIdIncoming, payload, env, now, { stdout, stderr });
}

function normaliseHarness(flag, env) {
  if (flag === 'claude-code' || flag === 'codex') return flag;
  if (flag && flag !== '') return 'unknown';
  if (env.CLAUDECODE === '1') return 'claude-code';
  for (const k of Object.keys(env)) {
    if (k.startsWith('CODEX_')) return 'codex';
  }
  return 'unknown';
}

async function readHarnessPayload(ctx) {
  // The wrapper trusts the caller only to supply the payload; when
  // driven by the harness the JSON arrives on stdin. Tests inject
  // via ctx.hookStdin (a string) to avoid piping through process.
  if (typeof ctx.hookStdin === 'string' && ctx.hookStdin.length > 0) {
    try { return JSON.parse(ctx.hookStdin); } catch { return null; }
  }
  const stdin = process.stdin;
  if (!stdin || (typeof stdin.isTTY === 'boolean' && stdin.isTTY)) return null;
  const buf = await new Promise((resolvePromise) => {
    let acc = '';
    let done = false;
    const finish = () => { if (!done) { done = true; resolvePromise(acc); } };
    stdin.setEncoding('utf8');
    stdin.on('data', (chunk) => { acc += chunk; });
    stdin.on('end', finish);
    stdin.on('error', finish);
    // A 1-second cap; hooks share a small budget and must never
    // block the harness on a stalled parent.
    setTimeout(finish, 1000).unref?.();
  });
  if (!buf) return null;
  try { return JSON.parse(buf); } catch { return null; }
}

async function runStopHook(projectRoot, harness, sessionId, payload, env, now, streams) {
  const settingsRead = await readFeedbackSettings(projectRoot);
  const fileOptOut = settingsRead.settings.ask === false;
  const envOptOut = env.RCF_FEEDBACK_ASK === '0' || env.RCF_FEEDBACK_DISABLE === '1';
  const optedOut = fileOptOut || envOptOut;

  // AC-16103-3: deferred entries from an earlier sessionId return to
  // pending here so a defer taken in session A is asked again in
  // session B whether or not the SessionStart hook fired first.
  await requeueDeferredForSession(projectRoot, sessionId, now);

  const all = await readEntries(projectRoot);
  const pending = all.filter((e) => e.status === 'pending');
  const pendingCount = pending.length;

  const ledger = await readAskLedger(projectRoot);
  const askedThisSession = Boolean(sessionId)
    && Array.isArray(ledger.asked)
    && ledger.asked.some((r) => r?.sessionId === sessionId);

  const stopHookActive = payload && (payload.stop_hook_active === true
    || payload.stopHookActive === true);

  const nowMs = now().getTime();
  const ages = pending
    .map((e) => Date.parse(e.recordedAt ?? ''))
    .filter((t) => Number.isFinite(t))
    .map((t) => nowMs - t);
  const newestPendingAgeMs = ages.length === 0 ? null : Math.min(...ages);
  const anyAskNow = pending.some((e) => e.askNow === true);
  const anyCarriedOver = Boolean(sessionId) && pending.some((e) => {
    const s = typeof e.sessionId === 'string' ? e.sessionId : '';
    return s !== '' && s !== sessionId;
  });
  const queueComplete = typeof ledger.queueStateAt === 'string' && ledger.queueStateAt.length > 0;

  const decision = shouldAsk({
    optedOut,
    pendingCount,
    askedThisSession,
    stopHookActive,
    anyAskNow,
    newestPendingAgeMs,
    quietMinutes: settingsRead.settings.quietMinutes,
    queueComplete,
    anyCarriedOver,
  });

  if (decision === 'ask' && sessionId) {
    // Ledger first, then emit (design 3.5 crash-safety clause).
    const askedAt = now().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const next = {
      ...ledger,
      asked: [...(Array.isArray(ledger.asked) ? ledger.asked : []), { sessionId, askedAt }],
    };
    await writeAskLedger(projectRoot, next);
  }
  const reason = buildAskReason(pendingCount);
  return emitHook(harness, decision, reason, streams);
}

async function runSessionStartHook(projectRoot, harness, sessionId, now, streams) {
  // AC-16103-3: deferred entries from an earlier sessionId return to
  // pending on SessionStart so the same session's Stop offers the
  // ask (design 3.1: defer = "not now", ask again next session).
  // The transition preserves the entry's prior sessionId so the
  // carry-over gate below still fires for the requeued entries.
  await requeueDeferredForSession(projectRoot, sessionId, now);

  const all = await readEntries(projectRoot);
  const pending = all.filter((e) => e.status === 'pending');
  const anyCarriedOver = pending.some((e) => {
    const s = typeof e.sessionId === 'string' ? e.sessionId : '';
    // Treat every pending entry as carried-over when we do not yet
    // have a sessionId to compare against (a first SessionStart on
    // a new session; the recorded sessionId is by definition prior).
    return s !== '' && (!sessionId || s !== sessionId);
  });
  if (!anyCarriedOver) return 0;
  const line = buildCarryOverLine(pending.length);
  return emitSessionStart(harness, line, streams);
}

async function runSessionEndHook(projectRoot, { now }) {
  const all = await readEntries(projectRoot);
  const pending = all.filter((e) => e.status === 'pending');
  if (pending.length === 0) return 0;
  // Compose a fingerprint-only bundle text (idempotency check reads
  // the last-written file and compares by content hash). We do not
  // change entry state on session-end; slice 4's `submit` remains
  // the terminal step. This is a safety flush of the exact set of
  // pending titles so a crashed session's findings are pastable.
  const stampSafe = now().toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[:]/g, '-');
  const dir = outboxDir(projectRoot);
  await mkdir(dir, { recursive: true });
  const filename = `${stampSafe}-session-end.md`;
  const path = resolve(dir, filename);
  const body = renderSessionEndBundle(pending, now());
  // Idempotency: two consecutive runs with the same pending set MUST
  // produce a single file. The only field that legitimately differs
  // between the two bodies is the `Generated:` timestamp; a naive
  // byte-compare therefore flaked whenever the two calls straddled a
  // second boundary (AC-16103-1 intermittent failure). Compare on a
  // canonical form that stamps the timestamp with a fixed placeholder,
  // so the byte-idempotency check honours the design intent (same
  // pending set = same bundle) regardless of wall-clock drift.
  const canon = (s) => s.replace(/^Generated: [^\n]*$/m, 'Generated: <stamp>');
  const bodyCanon = canon(body);
  try {
    const entries = await readdir(dir);
    for (const f of entries) {
      if (!f.endsWith('-session-end.md')) continue;
      try {
        const existing = await readFile(resolve(dir, f), 'utf8');
        if (canon(existing) === bodyCanon) return 0;
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  await writeFile(path, body, 'utf8');
  return 0;
}

function renderSessionEndBundle(pending, when) {
  const stamp = when.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const lines = [];
  lines.push('# rcf feedback: session-end pending bundle');
  lines.push('');
  lines.push(`Generated: ${stamp}`);
  lines.push(`Entries pending on this project at session end: ${pending.length}`);
  lines.push('');
  lines.push('The next session offers to send these on Stop (design 3.5).');
  lines.push('This bundle is a local reminder; no issue was filed.');
  lines.push('');
  for (const e of pending) {
    lines.push(`## ${e.id}: ${e.title ?? '(no title)'}`);
    lines.push('');
    lines.push(`- kind: ${e.kind ?? '?'}`);
    lines.push(`- target: ${e?.target?.ref ?? '?'}`);
    lines.push(`- anchor: ${e.anchor ?? '-'}`);
    lines.push(`- class: ${e.symptomClass ?? '?'}`);
    lines.push(`- severity: ${e.severity ?? '?'}`);
    if (e.fingerprint) lines.push(`- fingerprint: ${e.fingerprint}`);
    lines.push('');
  }
  return lines.join('\n');
}


// -- helpers ---------------------------------------------------------------

function inferHarness(env) {
  // F-slice-1-05: design 3.6 pins CLAUDECODE=1 and returns `unknown`
  // when neither harness leaves a signature. `other` is a legitimate
  // OPERATOR-declared value on --harness; the auto-fallback must not
  // conflate "unidentified" with a declared choice.
  if (env.CLAUDECODE === '1') return 'claude-code';
  for (const k of Object.keys(env)) {
    if (k.startsWith('CODEX_')) return 'codex';
  }
  return 'unknown';
}

/**
 * F-slice-1-09: sweep discarded entries older than the design 3.1
 * 30-day window. A `pruned` state line is appended for each expiring
 * entry so the reader's fold-by-id drops it from list/count surfaces
 * on the next read; the historical JSONL rows stay untouched (append-
 * only invariant). Best-effort: failures never break the caller.
 *
 * @param {string} projectRoot
 * @param {() => Date} nowFn
 * @param {number} [windowDays]
 */
async function pruneOldDiscarded(projectRoot, nowFn, windowDays = 30) {
  try {
    const all = await readEntries(projectRoot);
    const discardedAt = await readDiscardTimestamps(projectRoot);
    const now = typeof nowFn === 'function' ? nowFn() : new Date();
    const cutoff = now.getTime() - windowDays * 24 * 60 * 60 * 1000;
    for (const e of all) {
      if (e.status !== 'discarded') continue;
      // F-slice-1-09 fix: the 30-day clock runs from the discard
      // transition, not `recordedAt`. Design 3.1 L137 says "30 days
      // after discard"; the earlier reading would prune an entry
      // discarded today just because it was recorded 60 days ago.
      // If we cannot find a discard timestamp (a hand-authored
      // entry seeded with status:discarded, for instance), we err
      // on the safe side and keep the entry.
      const discardTs = discardedAt.get(e.id);
      if (typeof discardTs !== 'string') continue;
      const t = Date.parse(discardTs);
      if (!Number.isFinite(t) || t > cutoff) continue;
      // The state line is the only trace after prune; the raw body
      // stays visible in the fold-by-id read so `list --all` (below)
      // can still cite what was there and why it went. Never a silent
      // removal.
      await appendState(projectRoot, {
        id: e.id,
        at: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
        status: 'pruned',
      });
    }
  } catch (err) {
    if (process.env.RCF_FEEDBACK_TRACE_PRUNE === '1') {
      process.stderr.write(`[prune] failed: ${err.message}\n`);
    }
  }
}

async function readOwnVersion() {
  try {
    const pkg = JSON.parse(await readFile(resolve(PACKAGE_ROOT, 'package.json'), 'utf8'));
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Lookup a blueprint entry on `rcf/manifest.json:blueprints[]` by ref.
 * The lookup accepts a shelf slug (`security-auth-magic-link`), a
 * prefix:slug shape (`wsd:std-error-envelope`) and an effective slug
 * (`wsd-std-error-envelope`). Slice 3 lands the full resolver; slice 1
 * just needs the yes/no answer for the exit-3 branch.
 *
 * @param {string} projectRoot
 * @param {string} ref
 * @returns {Promise<null | { slug: string, version?: string | null, libraryPrefix?: string | null, libraryRef?: string | null, pin?: object }>}
 */
async function lookupBlueprintRecord(projectRoot, ref) {
  try {
    const manifest = JSON.parse(await readFile(resolve(projectRoot, 'rcf', 'manifest.json'), 'utf8'));
    // Delegate to the resolver's own findBlueprintRecord so the
    // qualified-ref safety (F-slice-3-01) applies here too; slice-1
    // stamping and slice-3 destination resolution walk the same
    // matcher, so a qualified WSD ref never picks up a shelf record
    // by slug collision.
    return findBlueprintRecord(manifest, ref);
  } catch { /* fall through to null */ }
  return null;
}
