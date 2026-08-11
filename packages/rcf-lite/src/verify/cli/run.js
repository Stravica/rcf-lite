// `rcf-verify run` (spec §3 primary verb). Parses flags, runs the
// verification orchestrator, writes the report artifact (always, regardless of
// gate — §3 rule 5), and sets the process exit code from the severity gate
// (§8.2: exit 0 below the gate, non-zero at/above it, and always non-zero for
// NOT-DEPLOYED / BLOCKED). This is the exact call-path build-lite's finalise
// step spawns (§8.2).

import { writeFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { parseArgs } from 'node:util';

import { formatError, isRcfError } from '@stravica-ai/rcf-lite-core/errors';

import { runVerification } from '../engine/index.js';
import { serialiseReport } from '../report/index.js';
import { gateTripped, FINDING_SEVERITIES } from '../verdict/index.js';

const OPTION_SPEC = {
  repo: { type: 'string' },
  chain: { type: 'string' },
  profile: { type: 'string' },
  url: { type: 'string' },
  'parity-env': { type: 'boolean' },
  provision: { type: 'string' },
  out: { type: 'string' },
  'severity-gate': { type: 'string' },
  'provision-mode': { type: 'string' },
  persona: { type: 'string' },
  help: { type: 'boolean' },
};

export const HELP = `Usage: rcf-verify run [options]

Launch a fresh-context adversarial verifier against a running app and emit a
structured verdict stamped with the runtime it ran against.

Required:
  --repo <path-or-ref>      RCF chain source (the acceptance contract)
  --profile <p>             Runtime profile: deployed | ci | local-dev
  --url <app-url>           The running app for this profile
  --out <report-path>       Where to write the structured report artifact

Optional:
  --chain <PRD/ref>         Which PRD/chain to verify against (default: the repo's)
  --parity-env              Assert this ci/local-dev runtime is edge-identical
                            to prod — the only path to a SHIP verdict from a
                            non-deployed profile. Logged in the report.
  --provision <path>        Provisioning spec / prerequisite credentials FILE
                            (never inline; secrets never echoed)
  --severity-gate <sev>     Exit non-zero at/above this severity:
                            PASS | COSMETIC | DEGRADED | BROKEN
  --provision-mode <m>      run | skip (default: run)
  --persona <name>          Adversarial persona flavour (default: generic-sceptic)
  --help                    Print this help

Exit codes:
  0  report written, verdict below the severity gate
  1  IO / unexpected runtime failure (e.g. the report could not be written)
  2  usage error (missing/invalid flags)
  3  chain could not be loaded (the acceptance contract is unreadable)
  5  severity gate tripped, or NOT-DEPLOYED / BLOCKED / LAUNCH-FAILURE
     (ship cannot be confirmed — a report is still written)
`;

function exitForError(err) {
  switch (err.kind) {
    case 'usage': return 2;
    case 'missingFile':
    case 'parseFailure':
    case 'validation': return 3;
    default: return 1; // ioFailure + anything unexpected
  }
}

/**
 * @param {string[]} argv - argv slice after `run`
 * @param {object} [deps]
 * @returns {Promise<number>}
 */
export async function main(argv, deps = {}) {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const cwd = deps.cwd ?? process.cwd();

  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTION_SPEC, allowPositionals: false, strict: true });
  } catch (err) {
    stderr.write(`[error] usage ${err.message}\n`);
    stderr.write(HELP);
    return 2;
  }
  const flags = parsed.values;
  if (flags.help) {
    stdout.write(HELP);
    return 0;
  }

  const gate = flags['severity-gate'];
  if (gate && !FINDING_SEVERITIES.includes(gate)) {
    stderr.write(`[error] usage --severity-gate must be one of ${FINDING_SEVERITIES.join(' | ')}\n`);
    return 2;
  }
  const provisionMode = flags['provision-mode'] ?? 'run';
  if (provisionMode !== 'run' && provisionMode !== 'skip') {
    stderr.write('[error] usage --provision-mode must be run | skip\n');
    return 2;
  }
  if (!flags.out) {
    stderr.write('[error] usage --out <report-path> is required\n');
    return 2;
  }
  // Dash-footgun (§3 rule 3, mirrors build's --body-file discipline): a
  // --provision value that looks like a flag is almost always a swallowed next
  // option or an attempt to pass a credential inline. Refuse it — credentials
  // are FILE-only, never inline, never echoed.
  if (typeof flags.provision === 'string' && flags.provision.startsWith('-')) {
    stderr.write('[error] usage --provision takes a file path, not a flag or inline value (credentials are never accepted inline)\n');
    return 2;
  }

  const result = await runVerification({
    repo: flags.repo,
    chainRef: flags.chain,
    profile: flags.profile,
    url: flags.url,
    parityEnv: Boolean(flags['parity-env']),
    provision: flags.provision,
    provisionMode,
    persona: flags.persona,
    severityGate: gate,
  }, deps);

  if (isRcfError(result)) {
    stderr.write(`${formatError(result, { verbose: true })}\n`);
    return exitForError(result);
  }

  const { report } = result;

  // The report is written ALWAYS, regardless of the gate (§3 rule 5).
  const outPath = resolvePath(cwd, flags.out);
  const writer = deps.writeFile ?? writeFile;
  try {
    await writer(outPath, serialiseReport(report), 'utf8');
  } catch (err) {
    stderr.write(`[rcf-verify] unexpected failure: could not write report: ${err.message}\n`);
    return 1;
  }

  stderr.write(`[rcf-verify] verdict ${report.verdict} [${report.verdictAuthority}] -> ${flags.out}\n`);

  // Exit code is the gate (§8.2). NOT-DEPLOYED / BLOCKED always trip.
  return gateTripped({ verdict: report.verdict, findings: report.findings, gate }) ? 5 : 0;
}
