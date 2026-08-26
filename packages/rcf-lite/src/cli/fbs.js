// `rcf fbs <fbs-id> <verb> [options]` subcommand handler
// (verification-integrity-cluster-spec §3.1, §5.2).
//
// One verb in Track A:
//   depends-on   append or replace a dependsOnServices[] entry
//
// Written at Define stage (build-cycle §3, spec §5.1) with the
// attestation mode drawn from the pre-flight config record. Never
// invented mid-Test to justify a green suite. The verb refuses to
// write an entry whose acIds are not on the FBS.

import { parseArgs } from 'node:util';

import { isRcfError, writeUnexpectedFailure } from '#core/errors';
import { updateDocument, walkTree } from '#core/store';

import { findProjectRoot } from '../view/index.js';

const VALID_MODES = new Set(['live', 'sandboxed', 'mocked', 'declaredMockOnly', 'notShipped']);

const DEPENDS_ON_OPTION_SPEC = {
  service: { type: 'string' },
  mode: { type: 'string' },
  acs: { type: 'string' },
  display: { type: 'string' },
  purpose: { type: 'string' },
  preflight: { type: 'string' },
  force: { type: 'boolean' },
  quiet: { type: 'boolean' },
  help: { type: 'boolean' },
};

export const HELP = `Usage: rcf build fbs <fbs-id> <verb> [options]

Verbs:
  depends-on              Record a third-party service dependency on this FBS

rcf fbs <fbs-id> depends-on --service <id> --mode <live|sandboxed|mocked|declaredMockOnly|notShipped>
    --acs <acId>[,<acId>...] [--display "..."] [--purpose "..."] [--preflight <pfc-id>]

Writes a dependsOnServices[] entry keyed by --service. Idempotent by
service id: an existing entry with the same id is replaced (silent
overwrite is intentional here — the entry is derived from the same
pre-flight ruling every time). --acs must reference ACs the FBS
already binds via its acIds.

Options common:
  --force                   Bypass the AC-in-FBS check (for repair only)
  --quiet                   Suppress non-error stdout
  --help                    Print this help
`;

/**
 * @param {string[]} argv - argv slice after `fbs`
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

  const fbsId = argv[0];
  const verb = argv[1];
  const rest = argv.slice(2);
  if (!verb) {
    stderr.write('[error] usage fbs: verb required (depends-on)\n');
    return 2;
  }
  if (!/^FBS-\d{3,}$/.test(fbsId)) {
    stderr.write(`[error] usage fbs: expected an FBS id like FBS-011, got '${fbsId}'\n`);
    return 2;
  }

  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    stderr.write('[error] usage no project root found (no rcf/manifest.json in this directory or any ancestor).\n');
    return 2;
  }
  const walkResult = await walkTree({ projectRoot });
  const tree = walkResult.tree;
  const fbs = tree.byId.get(fbsId);
  if (!fbs || tree.kindById.get(fbsId) !== 'fbs') {
    stderr.write(`[error] usage fbs: ${fbsId} not found or not an FBS\n`);
    return 2;
  }

  if (verb === 'depends-on') return runDependsOn({ fbsId, fbs, rest, projectRoot, tree, walkResult, stdout, stderr });
  stderr.write(`[error] usage fbs: unknown verb '${verb}' (expected depends-on)\n`);
  return 2;
}

async function runDependsOn({ fbsId, fbs, rest, projectRoot, tree, walkResult, stdout, stderr }) {
  let parsed;
  try {
    parsed = parseArgs({ args: rest, options: DEPENDS_ON_OPTION_SPEC, allowPositionals: false, strict: true });
  } catch (err) {
    stderr.write(`[error] usage ${err.message}\n`);
    return 2;
  }
  const flags = parsed.values;
  if (flags.help) { stdout.write(HELP); return 0; }

  if (!flags.service) return usageErr(stderr, 'fbs depends-on: --service required');
  if (!/^[a-z][a-zA-Z0-9]*$/.test(flags.service)) {
    return usageErr(stderr, `fbs depends-on: --service must be camelCase (got '${flags.service}')`);
  }
  if (!flags.mode) return usageErr(stderr, 'fbs depends-on: --mode required');
  if (!VALID_MODES.has(flags.mode)) {
    return usageErr(stderr, `fbs depends-on: unknown --mode '${flags.mode}' (expected ${[...VALID_MODES].join(' | ')})`);
  }
  if (!flags.acs) return usageErr(stderr, 'fbs depends-on: --acs required (comma-separated AC ids)');
  const acIds = flags.acs.split(',').map((s) => s.trim()).filter(Boolean);
  if (acIds.length === 0) return usageErr(stderr, 'fbs depends-on: --acs is empty');

  if (!flags.force) {
    const fbsAcIds = new Set(fbs.acIds ?? []);
    const outside = acIds.filter((ac) => !fbsAcIds.has(ac));
    if (outside.length > 0) {
      stderr.write(`[error] refused fbs depends-on: ${fbsId} does not bind AC(s): ${outside.join(', ')}; add them to the FBS first (or pass --force for a repair path).\n`);
      return 4;
    }
  }

  const entry = {
    id: flags.service,
    displayName: flags.display ?? flags.service,
    purpose: flags.purpose ?? `${flags.service} dependency`,
    attestationMode: flags.mode,
    acIds,
  };
  if (typeof flags.preflight === 'string' && flags.preflight.length > 0) {
    // If the operator passed a bare pfc id, expand to the full ref; if
    // they passed the composite (`pfc-...#services.<id>`) keep it.
    entry.preFlightRef = flags.preflight.includes('#')
      ? flags.preflight
      : `${flags.preflight}#services.${flags.service}`;
  }

  const existing = Array.isArray(fbs.dependsOnServices) ? fbs.dependsOnServices : [];
  const nextEntries = existing.filter((e) => e.id !== flags.service);
  nextEntries.push(entry);

  const sets = [{ path: 'dependsOnServices', value: nextEntries }];
  const result = await updateDocument({
    projectRoot, tree, id: fbsId, patch: null, sets, options: {}, walkErrors: walkResult.errors,
  });
  if (isRcfError(result)) return handleWriterError(result, stderr);
  if (!flags.quiet) {
    stdout.write(`fbs ${fbsId} depends-on: ${flags.service} (${flags.mode}) covers ${acIds.length} AC(s).\n`);
  }
  return 0;
}

function usageErr(stderr, message) {
  stderr.write(`[error] usage ${message}\n`);
  return 2;
}

function handleWriterError(err, stderr) {
  if (err.kind === 'ioFailure') { writeUnexpectedFailure(err, stderr); return 1; }
  stderr.write(`[error] ${err.kind} ${err.message}\n`);
  if (err.kind === 'usage') return 2;
  if (err.kind === 'validation' || err.kind === 'brokenReference') return 3;
  return 1;
}
