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
  newEntryId,
  readEntries,
  storeExists,
} from '../feedback/store.js';
import { redact, allowedHosts, findResidualSecrets } from '../feedback/redact.js';
import { fingerprint } from '../feedback/fingerprint.js';
import { renderIssue, renderComment, renderBundle } from '../feedback/render.js';
import { resolve as resolveDestination, listUnresolvedLibraries, findBlueprintRecord } from '../feedback/destination.js';
import { readLibraryRegistry } from '../blueprint/library-registry.js';
import { loadGhAdapter } from '../feedback/gh.js';
import { labelsForEntry } from '../feedback/labels.js';
import { outboxDir } from '../feedback/store.js';
import { mkdir, writeFile } from 'node:fs/promises';

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

Sub-verbs (later slices; refuse with exit 3 until they ship):
  opt-in     Slice 5: restore per-project ask (rcf/feedback-settings.json).
  opt-out    Slice 5: silence per-project ask (rcf/feedback-settings.json).
  hook       Slice 5: harness hook handler (stop, session-end, session-start).

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
  --evidence <pointer>          Repeatable: a command, a path:line
                                inside the project, or an id.
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
  3  outcome with residual pending (destination cannot be resolved on
     --kind blueprint; recorded destination unresolved)
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
    case 'opt-in':   return handleNotYet('opt-in', 'slice 5 (the ask, settings and hooks)', ctx);
    case 'opt-out':  return handleNotYet('opt-out', 'slice 5 (the ask, settings and hooks)', ctx);
    case 'hook':     return handleNotYet('hook', 'slice 5 (the ask, settings and hooks)', ctx);
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
  const { stdout, stderr, cwd } = ctx;
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

  // Blueprint-specific stamps (AC-15501-5).
  let blueprintStamp = {};
  if (kind === 'blueprint' && record) {
    blueprintStamp = {
      blueprintVersion: record.version ?? null,
      libraryPrefix: record.libraryPrefix ?? null,
      libraryRef: record.libraryRef ?? null,
      ...(record.pin?.resolvedSha ? { resolvedSha: record.pin.resolvedSha } : {}),
      ...(record.pin?.tarballSha256 ? { tarballSha256: record.pin.tarballSha256 } : {}),
    };
  }

  const recordedAt = ctx.now().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const id = newEntryId(ctx.now(), ctx.rng);

  const entry = {
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

  if (flags.json) {
    stdout.write(`${JSON.stringify(shown, null, 2)}\n`);
    return 0;
  }
  if (shown.length === 0) {
    stdout.write(flags.all
      ? 'no feedback entries.\n'
      : 'no pending feedback entries.\n');
    return 0;
  }
  const rows = shown.slice().sort((a, b) => (a.recordedAt ?? '').localeCompare(b.recordedAt ?? ''));
  for (const e of rows) {
    const statusCol = flags.all ? `[${e.status}] ` : '';
    stdout.write(`${statusCol}${e.id}  ${e.target?.ref ?? '?'}  ${e.symptomClass}  ${e.severity}  ${e.title}\n`);
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
  // The env-based silence is the only opt-out shape slice 1 knows
  // about; slice 5 adds the file-driven ask flag.
  const optOut = env.RCF_FEEDBACK_ASK === '0' || env.RCF_FEEDBACK_DISABLE === '1';
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
  const summary = {
    counts,
    optOut,
    optOutSource: optOut
      ? (env.RCF_FEEDBACK_DISABLE === '1' ? 'env:RCF_FEEDBACK_DISABLE' : 'env:RCF_FEEDBACK_ASK=0')
      : null,
    storePath: '.rcf/feedback/entries.jsonl',
    gh: ghSummary,
    destinations: {
      registeredLibraries: Array.isArray(registry?.libraries) ? registry.libraries.length : 0,
      unresolvedLibraries,
    },
  };

  if (flags.json) {
    stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return 0;
  }
  stdout.write(`feedback: ${counts.pending} pending, ${counts.submitted} submitted, ${counts.bundled} bundled, ${counts.deferredUntilSession} deferred, ${counts.discarded} discarded\n`);
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
  // Per-blueprint destination table (design 3.1 L140): for every
  // applied blueprint on the manifest, show the destination the
  // resolver would return today. Read-only, no network.
  const resolverInputsStatus = await loadResolverInputs(projectRoot);
  const appliedBlueprints = Array.isArray(resolverInputsStatus.manifest?.blueprints)
    ? resolverInputsStatus.manifest.blueprints
    : [];
  if (appliedBlueprints.length > 0) {
    stdout.write(`applied blueprints (${appliedBlueprints.length}):\n`);
    for (const r of appliedBlueprints) {
      const ref = r.libraryPrefix
        ? `${r.libraryPrefix}:${r.slug}`
        : (r.slug ?? r.name ?? '(unnamed)');
      const dest = await resolveDestination(
        { kind: 'blueprint', target: { ref } },
        resolverInputsStatus,
      );
      const cell = dest.repo
        ? `${dest.repo} (${dest.visibility}${dest.derived ? ', derived' : ''})`
        : `(unresolved${dest.reason ? `: ${dest.reason}` : ''})`;
      stdout.write(`  - ${ref} -> ${cell}\n`);
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
  const c = {
    pending: 0, submitted: 0, bundled: 0, deferredUntilSession: 0, discarded: 0,
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
  const pending = all.filter((e) => e.status === 'pending');
  let targets;
  if (flags.all) {
    if (parsed.positionals.length > 0) {
      stderr.write('[error] usage --all cannot be combined with entry ids\n');
      return 2;
    }
    targets = pending;
  } else {
    if (parsed.positionals.length === 0) {
      stderr.write('[error] usage discard: at least one entry id, or --all\n');
      return 2;
    }
    const wanted = new Set(parsed.positionals);
    const byId = new Map(pending.map((e) => [e.id, e]));
    targets = [];
    const missing = [];
    for (const id of wanted) {
      const e = byId.get(id);
      if (!e) { missing.push(id); continue; }
      targets.push(e);
    }
    if (missing.length > 0) {
      stderr.write(`[error] usage unknown pending entry id(s): ${missing.join(', ')}\n`);
      return 2;
    }
  }
  if (targets.length === 0) {
    stdout.write('no pending feedback entries to discard.\n');
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
 * Fold ledgers from several redact() calls into one, summing counts by
 * rule name and keeping the first sample for the operator disclosure.
 *
 * @param {Array<Array<{ rule: string, before: string, after: string, count: number }>>} ledgers
 * @returns {Array<{ rule: string, before: string, after: string, count: number }>}
 */
function mergeLedger(ledgers) {
  const byRule = new Map();
  const order = [];
  for (const ledger of ledgers) {
    for (const row of ledger) {
      if (!byRule.has(row.rule)) {
        order.push(row.rule);
        byRule.set(row.rule, { rule: row.rule, before: row.before, after: row.after, count: row.count });
      } else {
        const prev = byRule.get(row.rule);
        prev.count += row.count;
      }
    }
  }
  return order.map((r) => byRule.get(r));
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
 * limit 5). Zero hits -> create. One hit -> +1 comment. Many hits ->
 * comment on the lowest number and mention the others. Search failure
 * -> create with dedupe:unchecked. Closed search runs only after a
 * zero-hit open search so the create body can reference the prior
 * number.
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
      if (!searchOpen.ok) {
        dedupe = 'unchecked';
      } else {
        matches = searchOpen.value?.matches ?? [];
      }

      if (flags['dry-run']) {
        const plan = matches.length === 1
          ? `comment on #${matches[0].number}`
          : matches.length > 1
            ? `comment on #${matches.sort((a, b) => a.number - b.number)[0].number} (${matches.length} matches)`
            : 'create';
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
        // Comment.
        dedupe = 'comment';
        const commentBody = renderComment(e, {
          body: built.redacted.body,
          ledger: built.redacted.ledger,
        }, { fingerprint: built.fingerprint, includeBody: false }).body;
        result = await commentWithRetry(gh, {
          repo: destination.repo,
          number: matches[0].number,
          body: commentBody,
        });
      } else {
        // Many: comment on lowest, mention the others.
        dedupe = 'comment';
        const sorted = matches.slice().sort((a, b) => a.number - b.number);
        const others = sorted.slice(1).map((m) => `#${m.number}`).join(', ');
        const base = renderComment(e, {
          body: built.redacted.body,
          ledger: built.redacted.ledger,
        }, { fingerprint: built.fingerprint, includeBody: false }).body;
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
        stdout.write(`${e.id} -> ${result.url} (${dedupe})\n`);
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
    const outboxPath = await writeBundle(projectRoot, bundle.destination, bundle.rows, {
      generatedAt,
      rcfLiteVersion,
      reasonNotFiled: bundle.reason,
    });
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

// -- later-slice stubs -----------------------------------------------------

function handleNotYet(name, sliceLabel, ctx) {
  const { stderr } = ctx;
  stderr.write(`rcf feedback ${name}: not yet available (${sliceLabel}).\n`);
  return 3;
}

// -- helpers ---------------------------------------------------------------

function inferHarness(env) {
  if (env.CLAUDECODE === '1' || env.CLAUDECODE === 'true') return 'claude-code';
  for (const k of Object.keys(env)) {
    if (k.startsWith('CODEX_')) return 'codex';
  }
  return 'other';
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
