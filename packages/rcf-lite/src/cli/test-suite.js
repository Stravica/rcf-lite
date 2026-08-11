// `rcf test-suite <ts-id> <verb> [options]` subcommand handler
// (verification-integrity-cluster-spec §5.1, §7).
//
// Two verbs:
//   provenance   author runtimeProvenance on TS/TC (§5.1)
//   approve      promote TS.status draft -> approved (§7 Option A)
//
// Both go through the store's `updateDocument` writer so the post-write
// validation gate and reference-integrity checks fire uniformly.

import { parseArgs } from 'node:util';

import { isRcfError, writeUnexpectedFailure } from '@stravica-ai/rcf-lite-core/errors';
import { updateDocument, walkTree } from '@stravica-ai/rcf-lite-core/store';

import { findProjectRoot } from '../view/index.js';

const PROVENANCE_OPTION_SPEC = {
  tc: { type: 'string' },
  profile: { type: 'string' },
  'env-var': { type: 'string', multiple: true },
  host: { type: 'string', multiple: true },
  notes: { type: 'string' },
  force: { type: 'boolean' },
  quiet: { type: 'boolean' },
  help: { type: 'boolean' },
};

const APPROVE_OPTION_SPEC = {
  force: { type: 'boolean' },
  quiet: { type: 'boolean' },
  help: { type: 'boolean' },
};

const VALID_PROFILES = new Set(['mock', 'stub', 'fixture', 'live', 'mixed']);

export const HELP = `Usage: rcf test-suite <ts-id> <verb> [options]

Verbs:
  provenance                Author runtimeProvenance on the TS or a specific TC
  approve                   Promote the TS's authoringStatus to 'approved'

rcf test-suite <ts-id> provenance [--tc <tc-id>] --profile <mock|stub|fixture|live|mixed>
    [--env-var VAR ...] [--host host ...] [--notes "..."] [--force]

Records the runtime the test actually addressed on a specific TC (or
every TC in the TS when --tc is omitted and no existing block would be
overwritten). Refuses to overwrite an existing block without --force.

rcf test-suite <ts-id> approve [--force]

Writes authoringStatus: approved on the TS. Refuses without --force
when the TS is 'superseded'; --force also allows re-approval after
needsRevision. Stage-4 auto-promotion invokes this verb after
coverage --strict + tests pass; the operator only needs it for manual
override.

Options common:
  --quiet                   Suppress non-error stdout
  --help                    Print this help
`;

/**
 * @param {string[]} argv - argv slice after `test-suite`
 * @param {object} [deps]
 * @returns {Promise<number>}
 */
export async function main(argv, deps = {}) {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const cwd = deps.cwd ?? process.cwd();

  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    stdout.write(HELP);
    return argv[0] ? 0 : 2;
  }

  const tsId = argv[0];
  const verb = argv[1];
  const rest = argv.slice(2);
  if (!verb) {
    stderr.write('[error] usage test-suite: verb required (provenance | approve)\n');
    return 2;
  }
  if (!/^TS-\d{3}$/.test(tsId)) {
    stderr.write(`[error] usage test-suite: expected a TS id like TS-015, got '${tsId}'\n`);
    return 2;
  }

  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    stderr.write('[error] usage no project root found (no rcf/manifest.json in this directory or any ancestor).\n');
    return 2;
  }
  const walkResult = await walkTree({ projectRoot });
  const tree = walkResult.tree;
  const ts = tree.byId.get(tsId);
  if (!ts || tree.kindById.get(tsId) !== 'testSuite') {
    stderr.write(`[error] usage test-suite: ${tsId} not found or not a Test Suite\n`);
    return 2;
  }

  if (verb === 'provenance') return runProvenance({ tsId, ts, rest, projectRoot, tree, walkResult, stdout, stderr });
  if (verb === 'approve') return runApprove({ tsId, ts, rest, projectRoot, tree, walkResult, stdout, stderr });
  stderr.write(`[error] usage test-suite: unknown verb '${verb}' (expected provenance | approve)\n`);
  return 2;
}

async function runProvenance({ tsId, ts, rest, projectRoot, tree, walkResult, stdout, stderr }) {
  let parsed;
  try {
    parsed = parseArgs({ args: rest, options: PROVENANCE_OPTION_SPEC, allowPositionals: false, strict: true });
  } catch (err) {
    stderr.write(`[error] usage ${err.message}\n`);
    return 2;
  }
  const flags = parsed.values;
  if (flags.help) { stdout.write(HELP); return 0; }
  if (!flags.profile) {
    stderr.write('[error] usage test-suite provenance: --profile required\n');
    return 2;
  }
  if (!VALID_PROFILES.has(flags.profile)) {
    stderr.write(`[error] usage test-suite provenance: unknown --profile '${flags.profile}' (expected ${[...VALID_PROFILES].join(' | ')})\n`);
    return 2;
  }
  const envVars = flags['env-var'] ?? [];
  const hosts = flags.host ?? [];

  const block = {
    profile: flags.profile,
    envVarsRequired: envVars,
    externalHostsReached: hosts,
  };
  if (typeof flags.notes === 'string' && flags.notes.length > 0) {
    // Redaction discipline: notes must never contain a token; a naive
    // pattern grep here (looking for `=` followed by long alphanum
    // stretches) is a belt-and-braces check that fires on the obvious
    // paste-a-token mistake without pretending to be a real secret
    // scanner.
    if (/[A-Za-z0-9]{20,}/.test(flags.notes) && /=|token|secret|key/i.test(flags.notes)) {
      stderr.write('[error] usage test-suite provenance: --notes looks like it contains a token or secret; the notes field is prose-only, never quotes credential material.\n');
      return 2;
    }
    block.notes = flags.notes;
  }

  const tcs = Array.isArray(ts.testCases) ? ts.testCases : [];
  const targetTcIds = flags.tc ? [flags.tc] : tcs.map((tc) => tc.id);
  if (targetTcIds.length === 0) {
    stderr.write(`[error] usage test-suite provenance: ${tsId} has no test cases\n`);
    return 2;
  }
  if (flags.tc && !tcs.find((tc) => tc.id === flags.tc)) {
    stderr.write(`[error] usage test-suite provenance: TC ${flags.tc} not found on ${tsId}\n`);
    return 2;
  }

  const nextTcs = [];
  for (const tc of tcs) {
    if (!targetTcIds.includes(tc.id)) { nextTcs.push(tc); continue; }
    if (tc.runtimeProvenance && !flags.force) {
      stderr.write(`[error] refused test-suite provenance: TC ${tc.id} already carries runtimeProvenance; re-run with --force to overwrite.\n`);
      return 4;
    }
    nextTcs.push({ ...tc, runtimeProvenance: block });
  }

  const sets = [{ path: 'testCases', value: nextTcs }];
  const result = await updateDocument({
    projectRoot, tree, id: tsId, patch: null, sets, options: {}, walkErrors: walkResult.errors,
  });
  if (isRcfError(result)) return handleWriterError(result, stderr);
  stdout.write(`test-suite ${tsId} provenance updated on ${targetTcIds.length} test case(s).\n`);
  return 0;
}

async function runApprove({ tsId, ts, rest, projectRoot, tree, walkResult, stdout, stderr }) {
  let parsed;
  try {
    parsed = parseArgs({ args: rest, options: APPROVE_OPTION_SPEC, allowPositionals: false, strict: true });
  } catch (err) {
    stderr.write(`[error] usage ${err.message}\n`);
    return 2;
  }
  const flags = parsed.values;
  if (flags.help) { stdout.write(HELP); return 0; }
  const current = ts.status;
  if (current === 'approved') {
    if (!flags.quiet) stdout.write(`test-suite ${tsId} is already approved (no-op).\n`);
    return 0;
  }
  if (current === 'superseded' && !flags.force) {
    stderr.write(`[error] refused test-suite approve: ${tsId} is superseded; re-run with --force to re-approve.\n`);
    return 4;
  }
  if (current === 'needsRevision' && !flags.force) {
    stderr.write(`[error] refused test-suite approve: ${tsId} is needsRevision; re-run with --force after re-work.\n`);
    return 4;
  }
  const sets = [{ path: 'status', value: 'approved' }];
  const result = await updateDocument({
    projectRoot, tree, id: tsId, patch: null, sets, options: {}, walkErrors: walkResult.errors,
  });
  if (isRcfError(result)) return handleWriterError(result, stderr);
  if (!flags.quiet) stdout.write(`test-suite ${tsId} approved.\n`);
  return 0;
}

function handleWriterError(err, stderr) {
  if (err.kind === 'ioFailure') { writeUnexpectedFailure(err, stderr); return 1; }
  stderr.write(`[error] ${err.kind} ${err.message}\n`);
  if (err.kind === 'usage') return 2;
  if (err.kind === 'validation' || err.kind === 'brokenReference') return 3;
  return 1;
}
