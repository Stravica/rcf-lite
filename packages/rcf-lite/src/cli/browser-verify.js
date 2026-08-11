// `rcf browser-verify <fbs-id>` handler
// (ui-design-gate-0.7.0-spec §8, §9).
//
// Two modes:
//   --mode operatorSession           record an operator ack (no captures)
//   --mode agentScreenshotCritique   run the injected browser driver,
//                                    capture routes x themes, run
//                                    invariants + auth smoke, write the
//                                    browserVerification record.
//
// The agent driver is injectable via `deps.browserDriver`; the default
// stub emits zero captures and the record surfaces a warn on the
// `agentDriverWired` synthetic invariant, so the CLI is testable
// end-to-end without a live Playwright.
//
// --ack marks operatorAckAt on the latest record for the FBS (used to
// clear a warn verdict per §8.5).

import { parseArgs } from 'node:util';
import process from 'node:process';

import { walkTree } from '@stravica-ai/rcf-lite-core/store';
import { writeUnexpectedFailure, rcfError } from '@stravica-ai/rcf-lite-core/errors';

import { findProjectRoot } from '../view/index.js';
import {
  composeOperatorSessionRecord,
  runAgentScreenshotCritique,
  stubBrowserDriver,
  writeBrowserVerificationAck,
  writeBrowserVerificationRecord,
} from '../browser-verify/index.js';

const OPTION_SPEC = {
  mode: { type: 'string' },
  url: { type: 'string' },
  profile: { type: 'string' },
  'dry-run': { type: 'boolean' },
  json: { type: 'boolean' },
  quiet: { type: 'boolean' },
  ack: { type: 'boolean' },
  notes: { type: 'string' },
  help: { type: 'boolean' },
};

export const HELP = `Usage: rcf browser-verify <fbs-id> [options]

Stage 5 browser-verification gate for a UI-bearing FBS. Writes a
browserVerification record on the manifest; the finalise gate reads it.

Options:
  --mode <mode>             operatorSession | agentScreenshotCritique
                            (default: agentScreenshotCritique)
  --url <url>               Runtime URL to drive against (default: taken
                            from --profile, else http://127.0.0.1:3000).
  --profile <profile>       deployed | ci | local-dev (default: local-dev)
  --notes "..."             Agent-critique rubric findings to record on
                            the browserVerification.notes field.
  --dry-run                 Print the composed record; do not write.
  --json                    Emit the composed record as JSON to stdout.
  --quiet                   Suppress non-error confirmations.
  --ack                     Mark operatorAckAt on the latest record for
                            this FBS (used to clear a warn verdict).
  --help                    Print this help.

Exit codes:
  0  verdict pass
  1  IO / unexpected runtime failure
  2  usage error
  3  schema or tree validation failure
  4  verdict warn or block (Stage 5 refused; --ack clears a warn)
`;

/**
 * @param {string[]} argv
 * @param {object} [deps]
 * @returns {Promise<number>}
 */
export async function main(argv, deps = {}) {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const cwd = deps.cwd ?? process.cwd();

  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTION_SPEC, allowPositionals: true, strict: true });
  } catch (err) {
    stderr.write(`[error] usage ${err.message}\n`);
    stderr.write(HELP);
    return 2;
  }
  const flags = parsed.values;
  if (flags.help) { stdout.write(HELP); return 0; }
  if (parsed.positionals.length !== 1) {
    stderr.write('[error] usage browser-verify: expected exactly one <fbs-id> positional\n');
    return 2;
  }
  const fbsId = parsed.positionals[0];
  if (!/^FBS-\d{3,}$/.test(fbsId)) {
    stderr.write(`[error] usage browser-verify: expected an FBS id like FBS-011, got '${fbsId}'\n`);
    return 2;
  }
  const mode = flags.mode ?? 'agentScreenshotCritique';
  if (!['operatorSession', 'agentScreenshotCritique'].includes(mode)) {
    stderr.write(`[error] usage browser-verify: unknown --mode '${mode}' (expected operatorSession | agentScreenshotCritique)\n`);
    return 2;
  }
  const profile = flags.profile ?? 'local-dev';
  if (!['deployed', 'ci', 'local-dev'].includes(profile)) {
    stderr.write(`[error] usage browser-verify: unknown --profile '${profile}' (expected deployed | ci | local-dev)\n`);
    return 2;
  }
  const runtimeUrl = flags.url ?? defaultUrlForProfile(profile);

  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    stderr.write('[error] usage no project root found (no rcf/manifest.json in this directory or any ancestor). Run `rcf init` first.\n');
    return 2;
  }
  const walkResult = await walkTree({ projectRoot });
  if (walkResult.errors.length > 0) {
    stderr.write(`[warn] tree has ${walkResult.errors.length} pre-existing issue(s); proceeding\n`);
  }
  const { tree } = walkResult;
  const fbs = tree.byId.get(fbsId);
  if (!fbs || tree.kindById.get(fbsId) !== 'fbs') {
    stderr.write(`[error] usage browser-verify: ${fbsId} not found or not an FBS\n`);
    return 2;
  }
  if (fbs.uiBearing !== true) {
    stderr.write(`[warn] browser-verify: ${fbsId} is not uiBearing; the browser gate is a no-op. Set uiBearing=true if this FBS renders UI.\n`);
  }
  const now = deps.now ? new Date(deps.now()) : new Date();

  if (flags.ack) {
    const result = await writeBrowserVerificationAck({
      projectRoot, tree, fbsId, operatorAckAt: true, now,
    });
    if (result && 'kind' in result && 'message' in result) {
      if (result.kind === 'ioFailure') { writeUnexpectedFailure(result, stderr); return 1; }
      stderr.write(`[error] ${result.kind} ${result.message}\n`);
      if (result.kind === 'usage') return 2;
      if (result.kind === 'validation') return 3;
      return 1;
    }
    if (!flags.quiet) stdout.write(`browser-verify --ack: recorded operatorAckAt on latest record for ${fbsId}.\n`);
    return 0;
  }

  let record;
  try {
    if (mode === 'operatorSession') {
      record = composeOperatorSessionRecord({
        tree, fbs, runtimeUrl, runtimeProfile: profile,
        declaredRoutes: [],
        invariantTicks: [{ invariant: 'operatorAcknowledged', verdict: 'pass', severity: 'block' }],
        now,
      });
    } else {
      const browserDriver = deps.browserDriver ?? stubBrowserDriver;
      const fetchFn = deps.fetch ?? (typeof fetch === 'function' ? fetch : null);
      if (!fetchFn) {
        stderr.write('[error] usage browser-verify: no fetch available in the runtime; supply deps.fetch\n');
        return 2;
      }
      record = await runAgentScreenshotCritique({
        tree, fbs, runtimeUrl, runtimeProfile: profile,
        browserDriver, fetch: fetchFn,
        artefactDir: `.rcf/artefacts/${fbsId.toLowerCase()}`,
        critiqueNotes: flags.notes,
        now,
      });
    }
  } catch (err) {
    writeUnexpectedFailure(
      rcfError({ kind: 'ioFailure', message: `browser-verify: ${err.message}`, stack: err.stack }),
      stderr,
    );
    return 1;
  }

  if (flags.json) stdout.write(`${JSON.stringify(record, null, 2)}\n`);

  if (flags['dry-run']) {
    if (!flags.quiet) {
      renderSummary({ stdout, record });
    }
    return record.verdict === 'pass' ? 0 : 4;
  }

  const write = await writeBrowserVerificationRecord({ projectRoot, tree, record });
  if (write && 'kind' in write && 'message' in write) {
    if (write.kind === 'ioFailure') { writeUnexpectedFailure(write, stderr); return 1; }
    stderr.write(`[error] ${write.kind} ${write.message}\n`);
    if (write.kind === 'usage') return 2;
    if (write.kind === 'validation') return 3;
    return 1;
  }
  if (!flags.quiet) {
    renderSummary({ stdout, record });
    stdout.write(`browser-verify ${fbsId}: wrote ${record.id} to rcf/manifest.json (verdict=${record.verdict}).\n`);
  }
  return record.verdict === 'pass' ? 0 : 4;
}

function defaultUrlForProfile(profile) {
  if (profile === 'ci') return 'http://127.0.0.1:3000';
  if (profile === 'deployed') return '';
  return 'http://127.0.0.1:3000';
}

function renderSummary({ stdout, record }) {
  stdout.write(`\nbrowser-verify ${record.fbsId} (${record.mode}, ${record.runtimeProfile})\n`);
  if (typeof record.notes === 'string' && record.notes.length > 0) {
    stdout.write('  agent critique:\n');
    for (const line of record.notes.split('\n')) stdout.write(`    ${line}\n`);
  }
  stdout.write('  invariant checks:\n');
  for (const c of record.invariantChecks) {
    const detail = c.detail ? ` - ${c.detail}` : '';
    stdout.write(`    [${c.verdict}] ${c.invariant}${detail}\n`);
  }
  if (Array.isArray(record.authSmokeChecks) && record.authSmokeChecks.length > 0) {
    stdout.write('  auth smoke checks:\n');
    for (const c of record.authSmokeChecks) {
      const detail = c.detail ? ` - ${c.detail}` : '';
      stdout.write(`    [${c.verdict}] ${c.check} (status=${c.status ?? 'n/a'})${detail}\n`);
    }
  }
  stdout.write(`  verdict: ${record.verdict}\n\n`);
}
