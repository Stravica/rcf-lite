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

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { platform as osPlatform } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import process from 'node:process';

import { findProjectRoot } from '../view/index.js';
import {
  appendEntry,
  appendState,
  ensureGitignore,
  newEntryId,
  readEntries,
  storeExists,
} from '../feedback/store.js';
import { redact, allowedHosts } from '../feedback/redact.js';
import { fingerprint } from '../feedback/fingerprint.js';
import { renderIssue } from '../feedback/render.js';

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

Sub-verbs (later slices; refuse with exit 3 until they ship):
  submit     Slice 4: file each pending entry under the reporter's gh login.
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
    case 'submit':   return handleNotYet('submit', 'slice 4 (submit, dedupe, fallback)', ctx);
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

  // Destination resolution (slice 3 lands the resolver; slice 1 keeps
  // a minimal shape for --kind blueprint: check the manifest for the
  // target so we can honour the design §3.1 exit-3 "destination cannot
  // be resolved" contract. --kind core routes to the constant.
  let destination;
  let destinationUnresolved = false;
  if (kind === 'core') {
    destination = { repo: await coreRepo(), kind: 'core' };
  } else {
    const record = await lookupBlueprintRecord(projectRoot, target);
    if (!record) {
      destination = { reason: 'unresolved' };
      destinationUnresolved = true;
    } else {
      // Slice 3 fills repo + visibility; slice 1 records what we know
      // (the manifest record) so the entry is not lossy.
      destination = { blueprintRecord: record };
    }
  }

  // Environment stamp (design §3.6, F-2 extended).
  const environment = {
    harness,
    rcfLiteVersion: await readOwnVersion(),
    nodeVersion: process.versions.node,
    platform: osPlatform(),
  };

  // Blueprint-specific stamps (AC-15501-5).
  let blueprintStamp = {};
  if (kind === 'blueprint' && destination.blueprintRecord) {
    const r = destination.blueprintRecord;
    blueprintStamp = {
      blueprintVersion: r.version ?? null,
      libraryPrefix: r.libraryPrefix ?? null,
      libraryRef: r.libraryRef ?? null,
      ...(r.pin?.resolvedSha ? { resolvedSha: r.pin.resolvedSha } : {}),
      ...(r.pin?.tarballSha256 ? { tarballSha256: r.pin.tarballSha256 } : {}),
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
        effectiveSlug: destination.blueprintRecord?.slug ?? target,
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
      ? { reason: 'unresolved' }
      : (kind === 'core'
        ? { repo: destination.repo, kind: 'core' }
        // Slice 1 keeps the pending shape for blueprints; slice 3
        // adds { repo, visibility, derived } once the resolver lands.
        : { pending: true }),
  };

  await appendEntry(projectRoot, entry);

  // Count of pending entries after this write (fold-by-id read).
  const all = await readEntries(projectRoot);
  const pending = all.filter((e) => e.status === 'pending').length;

  stdout.write(`recorded ${id} (${pending} pending). Nothing sent.\n`);

  if (destinationUnresolved) {
    stderr.write(`destination unresolved: ${target}\n`);
    return 3;
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
  // about; slice 5 adds the file-driven ask flag and the destinations
  // table.
  const optOut = env.RCF_FEEDBACK_ASK === '0' || env.RCF_FEEDBACK_DISABLE === '1';
  const summary = {
    counts,
    optOut,
    optOutSource: optOut
      ? (env.RCF_FEEDBACK_DISABLE === '1' ? 'env:RCF_FEEDBACK_DISABLE' : 'env:RCF_FEEDBACK_ASK=0')
      : null,
    storePath: '.rcf/feedback/entries.jsonl',
    // Slice 4 populates gh availability; slice 1 reports it as unknown.
    gh: { present: null, authed: null, note: 'gh probe lands in slice 4 (submit, dedupe, fallback)' },
    // Slice 3 populates destinations; slice 1 reports it as pending.
    destinations: { note: 'destination table lands in slice 3 (destination resolution)' },
  };

  if (flags.json) {
    stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return 0;
  }
  stdout.write(`feedback: ${counts.pending} pending, ${counts.submitted} submitted, ${counts.bundled} bundled, ${counts.deferredUntilSession} deferred, ${counts.discarded} discarded\n`);
  stdout.write(`opt-out: ${optOut ? `yes (${summary.optOutSource})` : 'no'}\n`);
  stdout.write('gh: not probed (slice 4 wires the check).\n');
  return 0;
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

  const previews = entries.map((e) => buildPreview(e, context));

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
    stdout.write(`destination: ${p.destination.repo ?? '(unresolved)'} (${p.destination.visibility})\n`);
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
  let gitRemote;
  try {
    const manifest = JSON.parse(await readFile(resolve(projectRoot, 'rcf', 'manifest.json'), 'utf8'));
    if (typeof manifest.projectName === 'string') projectName = manifest.projectName;
    if (typeof manifest.gitRemote === 'string') gitRemote = manifest.gitRemote;
  } catch { /* absent is fine */ }

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

  return {
    projectRoot,
    projectName,
    operatorName,
    gitRemote,
    allowHosts: allowHostsExt,
  };
}

/**
 * Build one preview record for `--json` output and for the text
 * renderer. Pure over the entry + context.
 *
 * @param {object} entry
 * @param {import('../feedback/redact.js').RedactionContext} context
 * @returns {object}
 */
function buildPreview(entry, context) {
  const titleRes = redact(entry.title ?? '', context);
  const bodyRes = redact(entry.body ?? '', context);
  const evidenceRedacted = (entry.evidence ?? []).map((ev) => {
    const r = redact(ev.value ?? '', context);
    return { kind: ev.kind, value: r.text, ledger: r.ledger };
  });
  const combinedLedger = mergeLedger([titleRes.ledger, bodyRes.ledger, ...evidenceRedacted.map((e) => e.ledger)]);
  const fp = fingerprint(entry);
  const destination = destinationForPreview(entry);
  const rendered = renderIssue(entry, {
    title: titleRes.text,
    body: bodyRes.text,
    evidence: evidenceRedacted.map((e) => ({ kind: e.kind, value: e.value })),
    ledger: combinedLedger,
  }, { fingerprint: fp, destination });
  return {
    id: entry.id,
    fingerprint: fp,
    fingerprintFallback: entry.anchor == null || String(entry.anchor).trim() === '',
    destination,
    titleRendered: rendered.title,
    bodyRendered: rendered.body,
    labels: rendered.labels,
    ledger: combinedLedger,
    residual: [...titleRes.residual, ...bodyRes.residual],
  };
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

/**
 * Slice 2 has no destination resolver (slice 3 lands it). We report
 * what the entry stamped: a `{ repo, kind: 'core' }` for core entries,
 * unresolved for blueprints whose lookup failed at add time, and
 * pending for blueprints whose destination the resolver will fill in.
 *
 * @param {object} entry
 * @returns {{ repo: string | null, visibility: 'public' | 'private' | 'unresolved' | 'pending' }}
 */
function destinationForPreview(entry) {
  const d = entry?.destination ?? {};
  if (d.kind === 'core' && typeof d.repo === 'string') {
    return { repo: d.repo, visibility: 'public' };
  }
  if (d.reason === 'unresolved') {
    return { repo: null, visibility: 'unresolved' };
  }
  if (typeof d.repo === 'string') {
    const v = d.visibility === 'private' ? 'private' : d.visibility === 'public' ? 'public' : 'pending';
    return { repo: d.repo, visibility: v };
  }
  return { repo: null, visibility: 'pending' };
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

async function coreRepo() {
  try {
    const pkg = JSON.parse(await readFile(resolve(PACKAGE_ROOT, 'package.json'), 'utf8'));
    const bugs = typeof pkg.bugs === 'string' ? pkg.bugs : pkg.bugs?.url;
    if (typeof bugs === 'string') {
      const m = bugs.match(/github\.com\/([^/]+\/[^/#?]+?)(\.git)?\/issues\/?/i)
        ?? bugs.match(/github\.com\/([^/]+\/[^/#?]+?)(\.git)?$/i);
      if (m) return m[1];
    }
  } catch { /* fall through */ }
  return 'Stravica/rcf-lite';
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
    const list = Array.isArray(manifest?.blueprints) ? manifest.blueprints : [];
    // effective-slug and prefix:slug both normalise to `libraryPrefix-slug`.
    const wants = new Set();
    wants.add(ref);
    if (ref.includes(':')) {
      const [pre, slug] = ref.split(':');
      wants.add(`${pre}-${slug}`);
      wants.add(slug);
    } else if (ref.includes('-')) {
      wants.add(ref);
    }
    for (const r of list) {
      const candidates = [r.slug, r.effectiveSlug, r.name]
        .filter((s) => typeof s === 'string');
      for (const c of candidates) if (wants.has(c)) return r;
    }
  } catch { /* fall through to null */ }
  return null;
}
