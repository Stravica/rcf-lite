// `rcf finalise` subcommand handler (spec §8, amendments 4 + 5). The build-side
// home of the finalise-gate integration contract: the ship gate that promotes
// an FBS from `complete` to `verified` ONLY when an independent rcf-verify run
// against the deployed app passes.
//
//   rcf finalise <fbs-id> --url <deploy-url> [options]
//
// The spec (§8.2) offers two homes for this: overloading `rcf build --mark
// complete`, or "a dedicated finalise verb". This is the dedicated verb.
// `rcf build --mark` is a deterministic-only, pure transition path that runs
// PRE-deploy; the finalise gate spawns a subprocess, hits the network, and may
// prompt - it does not belong on the mark path. The `complete -> verified`
// transition is the exact semantic home: `verified` means "independently
// verified against the running deploy", which is precisely what rcf-verify
// stamps.
//
// Hard contract points (spec §8.2 / §9):
//   - verify is a FRESH SUBPROCESS with the isolation env, never an in-process
//     import (§8.2 / §9: the verifier agent must start cold, zero build context);
//   - the subprocess exit code is the gate (0 -> promote to verified;
//     non-zero -> stay put, surface findings);
//   - findings flow via the --out report file, not stdout scraping;
//   - if rcf-verify is absent, PROMPT to install (or accept an explicit
//     --install-verify flag) - NEVER silently skip the gate (§8.3).

import { resolve as resolvePath } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';

import { isRcfError, rcfError, writeUnexpectedFailure } from '@stravica-ai/rcf-lite-core/errors';
import { updateDocument, walkTree } from '@stravica-ai/rcf-lite-core/store';

import { findProjectRoot } from '../view/index.js';
import { kindOf } from '../query/index.js';
import {
  buildVerifyArgs,
  detectVerify,
  loadReport,
  resolveAbsentVerify,
  spawnVerify,
  summariseReport,
} from '../finalise/index.js';

// Kept in sync with verify's own sets by contract (build never imports verify -
// that would break the §9 independence guarantee). Profiles: spec §4.
// Severities: spec §5.1 finding taxonomy.
const PROFILES = new Set(['deployed', 'ci', 'local-dev']);
const SEVERITIES = new Set(['PASS', 'COSMETIC', 'DEGRADED', 'BROKEN']);
const DEFAULT_PROFILE = 'deployed';
const DEFAULT_GATE = 'BROKEN';
const DEFAULT_REPORT = '.rcf-verify-report.json';
// The finalise gate only makes sense on a built item; verified re-verify is
// allowed (the §5.4 loop re-runs the gate on a previously-verified item).
const FINALISABLE_STATUSES = new Set(['complete', 'verified']);

const OPTION_SPEC = {
  url: { type: 'string' },
  profile: { type: 'string' },
  'parity-env': { type: 'boolean' },
  provision: { type: 'string' },
  'severity-gate': { type: 'string' },
  out: { type: 'string' },
  chain: { type: 'string' },
  persona: { type: 'string' },
  'install-verify': { type: 'boolean' },
  quiet: { type: 'boolean' },
  help: { type: 'boolean' },
};

export const HELP = `Usage: rcf finalise <fbs-id> --url <deploy-url> [options]

The ship gate. Promotes an FBS at status complete to verified ONLY when an
independent rcf-verify run against the deployed app passes.

rcf-verify is launched as a FRESH SUBPROCESS (never in-process) so the
verifier agent starts cold, with zero build context - its only inputs are the
RCF chain (the acceptance contract) and the live URL. The subprocess exit code
is the gate; findings flow back via the --out report file.

If rcf-verify is not installed, finalise PROMPTS to install it (install-together
posture) - it never silently skips the gate. Off a TTY, pass --install-verify.

Required:
  <fbs-id>                  The FBS item to finalise (must be 'complete')
  --url <deploy-url>        The running deployed app to verify against

Options:
  --profile <p>             deployed | ci | local-dev (default: deployed)
  --parity-env              Assert a ci/local-dev runtime is edge-identical to
                            prod - the only path to a SHIP verdict off 'deployed'
  --provision <file>        Provisioning / prerequisite-credentials FILE
                            (never inline; secrets never echoed)
  --severity-gate <sev>     Block at/above this severity:
                            PASS | COSMETIC | DEGRADED | BROKEN (default: BROKEN)
  --out <path>              Where verify writes its report artifact
                            (default: ${DEFAULT_REPORT})
  --chain <PRD/ref>         Which PRD/chain to verify against (default: repo's)
  --persona <name>          Adversarial persona flavour
  --install-verify          If rcf-verify is absent, install it without
                            prompting (the sanctioned non-interactive path)
  --quiet                   Suppress non-error confirmations
  --help                    Print this help

Exit codes:
  0  gate passed - FBS marked verified
  1  IO / unexpected runtime failure
  2  usage error (bad flags, unknown / non-FBS id)
  3  schema validation or broken references (tree unreadable, or write refused)
  4  gate NOT passed (verify blocked ship) OR rcf-verify absent and install
     declined/unavailable - the FBS is left unchanged, findings surfaced
`;

/**
 * @param {string[]} argv - argv slice after `finalise`
 * @param {object} [deps] - injectable seams (detect / spawn / prompt / install /
 *   loadReport) for testing the gate without a real rcf-verify + live app.
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
  const positionals = parsed.positionals;
  if (flags.help) { stdout.write(HELP); return 0; }

  const usage = (message) => {
    stderr.write(`[error] usage finalise: ${message}\n`);
    return 2;
  };

  if (positionals.length === 0) return usage('an <fbs-id> positional is required');
  if (positionals.length > 1) return usage('multiple positional ids are not supported');
  const fbsId = positionals[0];
  if (fbsId.includes('*') || fbsId.includes('?')) {
    return usage('wildcard / glob positional not supported');
  }

  if (!flags.url) return usage('--url <deploy-url> is required');

  const profile = flags.profile ?? DEFAULT_PROFILE;
  if (!PROFILES.has(profile)) {
    return usage(`unknown --profile ${profile} (expected deployed | ci | local-dev)`);
  }
  const gate = flags['severity-gate'] ?? DEFAULT_GATE;
  if (!SEVERITIES.has(gate)) {
    return usage(`unknown --severity-gate ${gate} (expected PASS | COSMETIC | DEGRADED | BROKEN)`);
  }
  // Dash-footgun (mirrors build's --body-file / verify's --provision discipline):
  // a --provision that looks like a flag is a swallowed next option or an inline
  // credential. Credentials are FILE-only, never inline, never echoed.
  if (typeof flags.provision === 'string' && flags.provision.startsWith('-')) {
    return usage('--provision takes a file path, not a flag or inline value (credentials are never accepted inline)');
  }

  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    stderr.write('[error] usage no project root found (no rcf/manifest.json in this directory or any ancestor). Run `npx rcf init` to create and wire a project.\n');
    return 2;
  }

  // Walker errors block finalise entirely - no gate runs against a tree that
  // fails validation, and no status write lands (mirrors build --mark, §D6).
  const { tree, errors } = await walkTree({ projectRoot });
  if (errors.length > 0) {
    stderr.write('[error] validation the RCF tree does not validate; fix it before finalising.\n');
    return 3;
  }

  // The positional must be an FBS at a finalisable status.
  const kind = kindOf(tree, fbsId);
  if (kind !== 'fbs') {
    if (!kind) return usage(`id ${fbsId} not found`);
    return usage(`${fbsId} is a ${kind} id; finalise addresses FBS items only`);
  }
  const fbs = tree.byId.get(fbsId);
  const currentStatus = fbs.executionStatus;
  if (!FINALISABLE_STATUSES.has(currentStatus)) {
    stderr.write(`[error] refused finalise: ${fbsId} is '${currentStatus}'; the finalise gate promotes 'complete' -> 'verified'. `
      + `Mark it complete first: rcf build ${fbsId} --mark complete\n`);
    return 4;
  }

  const quiet = Boolean(flags.quiet);
  const io = { stdout, stderr, input: deps.input ?? process.stdin, output: deps.output ?? process.stdout };

  // --- rcf-verify install detection (§8.3) --------------------------------
  let detection = deps.detectVerify
    ? await deps.detectVerify({ cwd: projectRoot })
    : await detectVerify({ cwd: projectRoot });
  if (!detection.installed) {
    const isTty = deps.isTty ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
    const outcome = await resolveAbsentVerify(
      { installFlag: Boolean(flags['install-verify']), isTty },
      io,
      deps,
    );
    if (outcome.action === 'abort') {
      stderr.write(`[error] refused ${outcome.reason}\n`);
      return outcome.code;
    }
    // Installed - re-detect to get a concrete invocation.
    detection = deps.detectVerify
      ? await deps.detectVerify({ cwd: projectRoot })
      : await detectVerify({ cwd: projectRoot });
    if (!detection.installed) {
      stderr.write('[error] unexpected rcf-verify still not resolvable after install; install it manually and re-run.\n');
      return 1;
    }
  }

  // --- spawn the fresh verify subprocess (§8.2) ---------------------------
  const outPath = resolvePath(projectRoot, flags.out ?? DEFAULT_REPORT);
  const verifyArgs = buildVerifyArgs({
    repo: projectRoot,
    url: flags.url,
    profile,
    out: outPath,
    severityGate: gate,
    parityEnv: Boolean(flags['parity-env']),
    provision: flags.provision,
    chain: flags.chain,
    persona: flags.persona,
  });

  if (!quiet) {
    stdout.write(`[finalise] launching rcf-verify (fresh subprocess) against ${flags.url} [profile=${profile}]...\n`);
  }

  let spawnResult;
  try {
    spawnResult = deps.spawnVerify
      ? await deps.spawnVerify({ invocation: detection.invocation, verifyArgs, cwd: projectRoot }, deps)
      : await spawnVerify({ invocation: detection.invocation, verifyArgs, cwd: projectRoot }, deps);
  } catch (err) {
    writeUnexpectedFailure(
      rcfError({ kind: 'ioFailure', message: `finalise: could not launch rcf-verify: ${err.message}`, stack: err.stack }),
      stderr,
    );
    return 1;
  }

  // --- gate on the subprocess exit code (§8.2) ----------------------------
  if (spawnResult.code === 0) {
    // Gate passed. Promote to verified (idempotent if a re-verify of an
    // already-verified item).
    if (currentStatus === 'verified') {
      if (!quiet) stdout.write(`[finalise] gate passed; ${fbsId} already verified (re-verify) -> ${outPath}\n`);
      return 0;
    }
    const result = await updateDocument({
      projectRoot, tree, id: fbsId, sets: [{ path: 'executionStatus', value: 'verified' }], options: {},
    });
    if (isRcfError(result)) {
      if (result.kind === 'ioFailure') { writeUnexpectedFailure(result, stderr); return 1; }
      stderr.write(`[error] ${result.kind} ${result.message}\n`);
      if (result.kind === 'usage') return 2;
      if (result.kind === 'validation' || result.kind === 'brokenReference') return 3;
      return 1;
    }
    if (!quiet) stdout.write(`[finalise] gate passed; marked ${fbsId} complete -> verified. Report: ${outPath}\n`);
    return 0;
  }

  // Gate NOT passed. The FBS stays put; surface the findings from the report
  // (the §5.4 verify -> fix -> re-verify seam), then fail non-zero.
  stderr.write(`[finalise] gate NOT passed (rcf-verify exit ${spawnResult.code}); ${fbsId} left '${currentStatus}'.\n`);
  const loaded = await (deps.loadReport ? deps.loadReport(outPath, deps) : loadReport(outPath, deps));
  if (loaded.ok) {
    stderr.write(summariseReport(loaded.report));
    stderr.write(`Full report (build-lite ingestible, chain-node-addressed): ${outPath}\n`);
  } else {
    stderr.write(`[finalise] could not read the verify report: ${loaded.reason}\n`);
  }
  // Map verify's exit-code convention to finalise's. Verify: 2 usage, 3 chain
  // load, 5 gate/NOT-DEPLOYED/BLOCKED/LAUNCH-FAILURE, 1 io. A tripped ship gate
  // is a refusal to finalise -> 4; a verify usage/chain error surfaces as-is.
  if (spawnResult.code === 2) return 2;
  if (spawnResult.code === 3) return 3;
  if (spawnResult.code === 5) return 4;
  return 1;
}
