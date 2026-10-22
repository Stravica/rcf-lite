// `rcf-verify run` (spec §3 primary verb). Parses flags, runs the
// verification orchestrator, writes the report artifact (always, regardless of
// gate — §3 rule 5), and sets the process exit code from the severity gate
// (§8.2: exit 0 below the gate, non-zero at/above it, and always non-zero for
// NOT-DEPLOYED / BLOCKED). This is the exact call-path build-lite's finalise
// step spawns (§8.2).

import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve as resolvePath } from 'node:path';
import { parseArgs } from 'node:util';

import { formatError, isRcfError } from '#core/errors';

import { runVerification } from '../engine/index.js';
import {
  DEFAULT_VERIFY_MODE,
  VERIFY_MODES,
  isVerifyMode,
} from '../engine/deterministic.js';
import { isSemverString, PLAYWRIGHT_MCP_VERSION } from '../engine/launcher.js';
import { composeVerifyReport, serialiseReport, VERIFY_HANDS } from '../report/index.js';
import { normaliseFbsIds } from '../chain/scope.js';
import { isGzipFile, PACKAGED_ARTEFACT_PROFILE, runSuiteAsProbe } from '../suite/index.js';
import { packDirectory } from '../suite/pack.js';
import { isLoopbackUrl } from '../../finalise/ingest.js';
import { gateTripped, FINDING_SEVERITIES } from '../verdict/index.js';

const OPTION_SPEC = {
  repo: { type: 'string' },
  chain: { type: 'string' },
  profile: { type: 'string' },
  url: { type: 'string' },
  // FBS-218: takes the target environment name; a probe carrying
  // parityEnv resolves only when it matches.
  'parity-env': { type: 'string' },
  provision: { type: 'string' },
  out: { type: 'string' },
  'severity-gate': { type: 'string' },
  'provision-mode': { type: 'string' },
  persona: { type: 'string' },
  'playwright-mcp-version': { type: 'string' },
  // Issue 330 (2026-10-08): the verify mode. agentScreenshotCritique is
  // the parent-session default; deterministic is the model-free, in-
  // process mode a dispatched worker can run (never spawns `claude`).
  mode: { type: 'string' },
  // ADR-4147 (US-16504): verification scope. Repeatable; a comma list
  // is accepted too. Narrows the contract to the ACs bound to the named
  // FBS items. `rcf build finalise` passes its own FBS here by default.
  fbs: { type: 'string', multiple: true },
  // FBS-219 (US-19001): the Test-stage verify report. --hand stamps the
  // hand and writes VerifyReport v1 to rcf/verify-reports/<fbs>/<head12>.json.
  hand: { type: 'string' },
  'verifier-id': { type: 'string' },
  package: { type: 'string' },
  // FBS-225 (US-19301): a packed tarball; with no --url it selects package
  // target mode (the AC-bound suites run against the installed artefact).
  artefact: { type: 'string' },
  // FBS-226 (US-19302): npm install --offline, from the local npm cache only.
  offline: { type: 'boolean' },
  replace: { type: 'string' },
  // FBS-230 (AC-19005-5): a loopback --url with --hand names the engine
  // serving it and the committed HEAD it serves.
  engine: { type: 'string' },
  'served-sha': { type: 'string' },
  help: { type: 'boolean' },
};

const VERIFY_REPORTS_DIR = 'rcf/verify-reports';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// FBS-219: paths git reports changed (tracked or untracked) outside
// rcf/verify-reports/ under cwd's project. Read from git status on every
// call, never cached.
export function dirtyPathsOutsideReports(cwd) {
  const prefix = git(cwd, ['rev-parse', '--show-prefix']).trim();
  const exempt = `${prefix}${VERIFY_REPORTS_DIR}/`;
  return git(cwd, ['status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all'])
    .split('\0').filter(Boolean).map((entry) => entry.slice(3))
    .filter((path) => !path.startsWith(exempt));
}

// FBS-219: base URL for a package target given without --url (RFC 2606
// .invalid, never resolves). Paired with refusePackageFetch so no request
// leaves the process.
const PACKAGE_NO_URL = 'http://package.invalid/';

function refusePackageFetch(packageRef) {
  return async () => {
    throw new Error(`package target ${packageRef} has no served URL; pass --url to probe it`);
  };
}

// FBS-226 (AC-19302-3): write package target mode's evidence files under
// <evidenceDir>, with a .gitignore there that keeps its *.log files
// un-ignored even when the project's own ignore rules match *.log.
async function writeEvidence(cwd, evidenceDir, files) {
  await mkdir(resolvePath(cwd, evidenceDir), { recursive: true });
  await writeFile(resolvePath(cwd, evidenceDir, '.gitignore'), '!*.log\n', 'utf8');
  for (const file of files) {
    await writeFile(resolvePath(cwd, evidenceDir, file.name), file.content, 'utf8');
  }
}

async function readOwnVersion() {
  const pkgPath = new URL('../../../package.json', import.meta.url);
  return JSON.parse(await readFile(pkgPath, 'utf8')).version;
}

export const HELP = `Usage: rcf verify run [options]
       rcf verify run (--artefact <tgz> | --package <dir>) --fbs <fbs-id> --hand verifier [--verifier-id <id>] [--offline] [--replace <reason>]

Launch a fresh-context adversarial verifier against a running app and emit a
structured verdict stamped with the runtime it ran against.

Required:
  --repo <path-or-ref>      RCF chain source (the acceptance contract)
  --profile <p>             Runtime profile: deployed | ci | local-dev
  --url <app-url>           The running app for this profile
  --out <report-path>       Where to write the structured report artifact

Optional:
  --chain <PRD/ref>         Which PRD/chain to verify against (default: the repo's)
  --fbs <fbs-id>            Verify only the acceptance criteria bound to this
                            FBS (repeatable; a comma list is accepted). Without
                            it the whole chain is verified. The report records
                            the scope as run.scope ('chain' or 'fbs:<ids>')
                            and the AC count as run.scopeAcCount. An unknown
                            id, or an FBS with no bound criteria, refuses with
                            exit 2. 'rcf build finalise <fbs-id>' passes its
                            own FBS here by default.
  --parity-env <env>        Assert this ci/local-dev runtime is edge-identical
                            to prod — the only path to a SHIP verdict from a
                            non-deployed profile. Logged in the report. In
                            deterministic mode a probe carrying parityEnv
                            resolves only when it equals <env>; otherwise it
                            is recorded skipped ('parityEnv mismatch').
  --provision <path>        Provisioning spec / prerequisite credentials FILE
                            (never inline; secrets never echoed)
  --severity-gate <sev>     Exit non-zero at/above this severity:
                            PASS | COSMETIC | DEGRADED | BROKEN
  --provision-mode <m>      Prerequisite provisioning (default: run):
                              run   derive prerequisites from the ACs and
                                    provision what verify can (auth signups
                                    where a route exists; service sandboxes
                                    and seed data are out-of-band and refuse
                                    honestly). An AC whose prerequisite
                                    cannot be provisioned is reported
                                    BLOCKED rather than silently skipped.
                              skip  bypass provisioning entirely for chains
                                    whose prerequisites are supplied out of
                                    band (admin-seeded auth accounts,
                                    pre-populated test data, operator-
                                    managed service sandboxes). The mode is
                                    disclosed on report.provisioning.mode so
                                    a promoted tree records that provisioning
                                    was skipped rather than satisfied.
  --persona <name>          Adversarial persona flavour (default: generic-sceptic)
  --playwright-mcp-version <semver>
                            Override the pinned Playwright MCP version for
                            one run (emergency use only; a loud stderr notice
                            fires and the report records the overridden pin
                            as runStats.playwrightMcpVersion). Must be an
                            exact semver X.Y.Z.
  --mode <mode>             Verify mode (default: agentScreenshotCritique):
                              agentScreenshotCritique  parent-session mode;
                                 spawns the agent CLI as a subagent with
                                 Playwright MCP, drives the live app with a
                                 model, and emits per-AC findings. Only run
                                 from a parent session that may spawn the
                                 agent CLI.
                              deterministic  model-free, in-process mode a
                                 dispatched worker can run; resolves each
                                 AC's probe (on the AC, else in
                                 rcf/verify-catalog.json) to pass, fail or
                                 skipped with evidence on report.perAc[];
                                 an AC with no probe is 'critiqueOnly' on
                                 blockedAcs[]. Stamps runStats.counts =
                                 { verified, failed, skipped, critiqueOnly,
                                 total }. Exits 0 only when every in-scope
                                 AC passed, 4 otherwise.
  --hand <hand>             Test-stage verify report (FBS-219): stamp the
                            hand (test-author | builder | reviewer | verifier |
                            stage-keeper) and write VerifyReport v1 to
                            rcf/verify-reports/<fbs-id>/<head12>.json. Needs
                            exactly one --fbs and a clean working tree outside
                            rcf/verify-reports/ (exit 4 otherwise). --out is
                            refused with --hand (exit 2): the report path is
                            the verb's. Prints
                            "verify report: <path> <verdict> <verified>/<total>".
  --verifier-id <id>        The verifier identity recorded on the report
  --engine <name>           The engine serving a --url target (free text,
                            for example "wrangler dev" or "node server");
                            recorded as target.engine with target.port
                            (the URL's port, else 80 / 443 by scheme).
                            Required with --hand and a loopback --url
                            (localhost, *.localhost, 127.0.0.0/8, ::1,
                            0.0.0.0), exit 2 otherwise
  --served-sha <sha>        The full sha of the committed HEAD the --url
                            target serves, recorded as target.servedSha.
                            Required with --hand and a loopback --url
                            (exit 2); any other sha exits 4. rcf build
                            finalise accepts a loopback report only when it
                            names the engine, the port and this served sha
  --package <ref>           Version-host target (name@version or tarball):
                            the report records target.kind "package" and
                            target.packageRef; --url is then optional and
                            probes need it to reach a served build.
                            With <ref> naming a directory and no --url or
                            --artefact (FBS-226): refuse (exit 4) a <dir>
                            outside the cwd's repository, then a dirty tree;
                            export HEAD into a scratch directory under the
                            OS temp dir (removed after the run) and run
                            npm pack --pack-destination <scratch> --json in
                            <dir>'s path there, never in the live directory:
                            content ignored there never reaches the bytes,
                            and a lifecycle script such as prepack writes
                            only inside the export (its output is in the
                            bytes, as in a separate pack of HEAD) and never
                            reaches the project; then take the --artefact
                            path over the packed tarball. The report records
                            pack { command, exitCode } and target.servedSha
                            HEAD. A failed pack exits 1, writes npm's output
                            to rcf/verify-reports/<fbs-id>/<head12>/pack.log
                            and no report JSON. Evidence directories carry a
                            .gitignore keeping their *.log files tracked.
  --artefact <tgz>          Package target mode (FBS-225): with no --url,
                            install the packed tarball in a scratch project
                            under the OS temp dir, run the test files bound
                            to the FBS's criteria (TS/TC testPointers) with
                            node --test against the installed package, and
                            write VerifyReport v1 with method suiteAsProbe,
                            profile packagedArtefact, the artefact identity,
                            install and suites[] evidence; raw TAP and the
                            install log go to
                            rcf/verify-reports/<fbs-id>/<head12>/. Needs
                            --hand and exactly one --fbs; mode defaults to
                            deterministic. --url, any other --mode or
                            --profile, and a missing or non-gzip path exit 2.
                            Exit 0 PASS, 4 not PASS, 1 install failure
                            (the log goes to
                            rcf/verify-reports/<fbs-id>/<head12>/install.log;
                            no report JSON is written).
  --offline                 Package target mode only (--artefact <tgz> |
                            --package <dir>, with no --url): npm install
                            --offline, from the local npm cache only; the
                            report records install.registry offline
                            (default otherwise). Anywhere else (a --url
                            target, --package name@version or a tarball
                            name, or no target) it exits 2 before any other
                            check, writing nothing
  --replace <reason>        Overwrite an existing report for the same head
  --help                    Print this help

Exit codes:
  0  report written, verdict below the severity gate
  1  IO / unexpected runtime failure (e.g. the report could not be written)
  2  usage error (missing/invalid flags)
  3  chain could not be loaded (the acceptance contract is unreadable)
  5  severity gate tripped, or NOT-DEPLOYED / BLOCKED / LAUNCH-FAILURE
     (ship cannot be confirmed — a report is still written)
`;

// FBS-225 (US-19301, TAC-4151): package target mode. Usage refusals
// (exit 2) first, then FBS-219's dirty-tree and existing-report refusals
// (exit 4), then (FBS-226, --package <dir>) the pack, then install, run
// and write; nothing lands under
// rcf/verify-reports/ before the usage checks pass. The mode is
// deterministic and the profile packagedArtefact unless a flag says
// otherwise, and a flag that says otherwise is refused.
async function runArtefactMode(flags, { stdout, stderr, cwd, env }) {
  const usage = (message) => {
    stderr.write(`[error] usage ${message}\n`);
    return 2;
  };
  // FBS-226: no --artefact means main routed a --package <dir> here.
  const packing = flags.artefact === undefined;
  const via = packing ? '--package <dir>' : '--artefact';
  if (flags.url !== undefined) return usage('--url is not allowed with --artefact: package target mode has no served URL');
  if (flags.mode !== undefined && flags.mode !== 'deterministic') {
    return usage(`--mode must be deterministic with ${via} (got "${flags.mode}")`);
  }
  if (flags.profile !== undefined && flags.profile !== PACKAGED_ARTEFACT_PROFILE) {
    return usage(`--profile must be ${PACKAGED_ARTEFACT_PROFILE} with ${via} (got "${flags.profile}")`);
  }
  if (flags.out !== undefined) return usage('--out is not allowed with --hand; the report is written under rcf/verify-reports/<fbs-id>/');
  if (flags.hand === undefined || !VERIFY_HANDS.includes(flags.hand)) {
    return usage(`--hand must be one of ${VERIFY_HANDS.join(' | ')} with ${via}`);
  }
  const fbsIds = normaliseFbsIds(flags.fbs);
  if (fbsIds.length !== 1) return usage('--fbs <fbs-id> is required with --hand (exactly one build spec)');
  let tgz = packing ? null : resolvePath(cwd, flags.artefact);
  if (!packing) {
    if (!existsSync(tgz)) return usage(`--artefact ${flags.artefact}: no such file`);
    if (!isGzipFile(tgz)) return usage(`--artefact ${flags.artefact}: not a gzip tarball`);
  }

  let headSha;
  let packAt = null;
  try {
    // FBS-226 (AC-19302-5): the packed bytes come from cwd's committed head,
    // so a package directory in another repository, or in none, is refused
    // before the dirty check and before any pack.
    if (packing) {
      const top = git(cwd, ['rev-parse', '--show-toplevel']).trim();
      const dir = resolvePath(cwd, flags.package);
      let dirTop = null;
      try { dirTop = git(dir, ['rev-parse', '--show-toplevel']).trim(); } catch { /* in no repository */ }
      if (dirTop !== top) {
        stderr.write(`verify report refused: --package ${flags.package} is outside this repository; the packed bytes must come from its committed head\n`);
        return 4;
      }
      packAt = { top, prefix: git(dir, ['rev-parse', '--show-prefix']).trim() };
    }
    if (dirtyPathsOutsideReports(cwd).length > 0) {
      stderr.write('verify report refused: working tree is dirty; the report must name a committed head\n');
      return 4;
    }
    headSha = git(cwd, ['rev-parse', 'HEAD']).trim();
  } catch (err) {
    stderr.write(`[rcf-verify] unexpected failure: could not read the git head: ${err.message}\n`);
    return 1;
  }
  const reportDir = `${VERIFY_REPORTS_DIR}/${fbsIds[0]}`;
  const verifyReportPath = `${reportDir}/${headSha.slice(0, 12)}.json`;
  if (existsSync(resolvePath(cwd, verifyReportPath)) && !flags.replace) {
    stderr.write(`verify report exists for head ${headSha.slice(0, 7)}; pass --replace "<reason>"\n`);
    return 4;
  }

  const evidenceDir = `${reportDir}/${headSha.slice(0, 12)}`;
  // FBS-226 (AC-19302-1): pack HEAD, exported into a scratch directory
  // outside the project; the tarball is removed with it after the run. A
  // failed pack leaves its log (AC-19302-3) and no report JSON.
  let pack = null;
  if (packing) {
    pack = await packDirectory({ ...packAt, headSha, env: env ?? process.env });
    if (!pack.tgz) {
      rmSync(pack.scratch, { recursive: true, force: true });
      const logPath = `${evidenceDir}/pack.log`;
      try {
        await writeEvidence(cwd, evidenceDir, [{ name: 'pack.log', content: pack.log }]);
      } catch (err) {
        stderr.write(`[rcf-verify] unexpected failure: could not write the pack log: ${err.message}\n`);
        return 1;
      }
      stderr.write(`verify run: pack failed (npm exit ${pack.exitCode}); log ${logPath}\n`);
      return 1;
    }
    tgz = pack.tgz;
  }
  stderr.write(`Verify mode: deterministic, method suiteAsProbe, profile ${PACKAGED_ARTEFACT_PROFILE} (${packing ? `packed ${flags.package}` : flags.artefact})\n`);
  let result;
  try {
    result = await runSuiteAsProbe({
      repo: flags.repo ?? cwd,
      fbsId: fbsIds[0],
      headSha,
      tgz,
      evidenceDir,
      hand: flags.hand,
      verifierId: flags['verifier-id'],
      rcfLiteVersion: await readOwnVersion(),
      offline: flags.offline === true,
      ...(pack ? { pack: { command: pack.command, exitCode: pack.exitCode }, servedSha: headSha } : {}),
      env,
    });
  } finally {
    if (pack) rmSync(pack.scratch, { recursive: true, force: true });
  }
  if (!result.ok && !result.evidence) {
    stderr.write(`${result.message}\n`);
    return result.code;
  }
  try {
    // FBS-226 (AC-19302-3): a failed install still leaves its log.
    await writeEvidence(cwd, evidenceDir, result.evidence);
    if (!result.ok) {
      stderr.write(`${result.message}\n`);
      return result.code;
    }
    await writeFile(resolvePath(cwd, verifyReportPath), serialiseReport(result.verifyReport), 'utf8');
  } catch (err) {
    stderr.write(`[rcf-verify] unexpected failure: could not write verify report: ${err.message}\n`);
    return 1;
  }
  const { verdict, runStats: { counts } } = result.verifyReport;
  stdout.write(`verify report: ${verifyReportPath} ${verdict} ${counts.verified}/${counts.total}\n`);
  return verdict === 'PASS' ? 0 : 4;
}

// FBS-226 (US-19302): --package naming an existing directory, with no
// --url, packs the artefact; name@version and a tarball keep FBS-219's
// record-only path.
// FBS-230 (AC-19005-5): a URL target; with --engine or --served-sha it also
// records the engine, the port (the URL's, else 80 / 443 by scheme) and the
// served sha.
function urlTarget(flags) {
  const target = { kind: 'url', url: flags.url };
  if (flags.url === undefined || (flags.engine === undefined && flags['served-sha'] === undefined)) return target;
  const url = new URL(flags.url);
  const port = url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80);
  return {
    ...target,
    ...(flags.engine === undefined ? {} : { engine: flags.engine }),
    port,
    ...(flags['served-sha'] === undefined ? {} : { servedSha: flags['served-sha'] }),
  };
}

function isPackDirectory(flags, cwd) {
  if (flags.package === undefined || flags.url !== undefined) return false;
  try {
    return statSync(resolvePath(cwd, flags.package)).isDirectory();
  } catch {
    return false;
  }
}

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
  const packageTarget = flags.artefact !== undefined || isPackDirectory(flags, cwd);
  // FBS-226 (BH-3): --offline selects the install store policy, so outside
  // package target mode it is refused before any other check or work.
  if (flags.offline && !packageTarget) {
    stderr.write('[error] usage --offline applies only in package target mode (--artefact <tgz> | --package <dir>, with no --url)\n');
    return 2;
  }
  if (packageTarget) {
    return runArtefactMode(flags, { ...deps, stdout, stderr, cwd });
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
  // FBS-219: --hand writes the Test-stage report; usage first, then the
  // committed-head and no-overwrite refusals, all before any probe runs.
  let verifyReportPath = null;
  let headSha = null;
  const handFbsIds = normaliseFbsIds(flags.fbs);
  if (flags.hand !== undefined) {
    if (!VERIFY_HANDS.includes(flags.hand)) {
      stderr.write(`[error] usage --hand must be one of ${VERIFY_HANDS.join(' | ')} (got "${flags.hand}")\n`);
      return 2;
    }
    if (flags.out !== undefined) {
      stderr.write('[error] usage --out is not allowed with --hand; the report is written under rcf/verify-reports/<fbs-id>/\n');
      return 2;
    }
    if (handFbsIds.length !== 1) {
      stderr.write('[error] usage --fbs <fbs-id> is required with --hand (exactly one build spec)\n');
      return 2;
    }
    if (flags.url !== undefined && isLoopbackUrl(flags.url)) {
      if (!flags.engine) {
        stderr.write('[error] usage --engine <name> is required with --hand and a loopback --url\n');
        return 2;
      }
      if (!flags['served-sha']) {
        stderr.write('[error] usage --served-sha <sha> is required with --hand and a loopback --url\n');
        return 2;
      }
    }
    try {
      if (dirtyPathsOutsideReports(cwd).length > 0) {
        stderr.write('verify report refused: working tree is dirty; the report must name a committed head\n');
        return 4;
      }
      headSha = git(cwd, ['rev-parse', 'HEAD']).trim();
    } catch (err) {
      stderr.write(`[rcf-verify] unexpected failure: could not read the git head: ${err.message}\n`);
      return 1;
    }
    const servedSha = flags['served-sha'];
    if (servedSha !== undefined && servedSha !== headSha) {
      stderr.write(`verify report refused: --served-sha ${servedSha} is not the committed HEAD ${headSha.slice(0, 7)}\n`);
      return 4;
    }
    verifyReportPath = `${VERIFY_REPORTS_DIR}/${handFbsIds[0]}/${headSha.slice(0, 12)}.json`;
    if (existsSync(resolvePath(cwd, verifyReportPath)) && !flags.replace) {
      stderr.write(`verify report exists for head ${headSha.slice(0, 7)}; pass --replace "<reason>"\n`);
      return 4;
    }
  } else if (!flags.out) {
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

  // --playwright-mcp-version override (spec 2026-09-03, section 1.4). Semver
  // only; anything else refuses exit 2 with the spec-named message. When set,
  // the effective pin fires a loud stderr override notice on preflight; when
  // unset, preflight prints the pinned default.
  const overrideRaw = flags['playwright-mcp-version'];
  if (overrideRaw !== undefined && !isSemverString(overrideRaw)) {
    // Spec sections 1.4 and 6 name the message without a prefix. The
    // module's other refusals prefix with `[error] usage`, but this one
    // is the spec-verbatim line and stands on its own.
    stderr.write(`--playwright-mcp-version expects a semver string, got '${overrideRaw}'\n`);
    return 2;
  }
  if (overrideRaw !== undefined) {
    // Loud override notice on stderr (spec 1.4: not silenceable with quiet).
    stderr.write(`Playwright MCP: OVERRIDE @playwright/mcp@${overrideRaw} (pinned default: ${PLAYWRIGHT_MCP_VERSION})\n`);
  } else {
    stderr.write(`Playwright MCP: pinned to @playwright/mcp@${PLAYWRIGHT_MCP_VERSION}\n`);
  }

  // Issue 330: resolve --mode. Unknown value refuses exit 2 so a typo
  // does not silently fall through to the default agent mode (a
  // dispatched worker that typed --mode=determinstic would otherwise
  // spawn `claude` and be killed by the harness).
  const modeFlag = flags.mode;
  if (modeFlag !== undefined && !isVerifyMode(modeFlag)) {
    stderr.write(`[error] usage --mode must be one of ${VERIFY_MODES.join(' | ')} (got "${modeFlag}")\n`);
    return 2;
  }
  const mode = modeFlag ?? DEFAULT_VERIFY_MODE;
  if (mode === 'deterministic') {
    stderr.write('Verify mode: deterministic (model-free, in-process; a dispatched worker can run this)\n');
  }
  // ADR-4147: the verification scope. Printed before the run so an
  // operator watching a long pass knows what it covers; the resolved AC
  // count follows on the report line once the chain has been read.
  const fbsIds = normaliseFbsIds(flags.fbs);
  if (fbsIds.length > 0) {
    stderr.write(`Verify scope: ${fbsIds.join(', ')} (only the acceptance criteria bound to ${fbsIds.length === 1 ? 'this FBS' : 'these FBS items'})\n`);
  }

  const result = await runVerification({
    repo: flags.repo,
    chainRef: flags.chain,
    profile: flags.profile,
    // FBS-219: a package target with no served URL resolves every probe
    // against an address that never answers, so each lands skipped.
    url: flags.url ?? (flags.package !== undefined ? PACKAGE_NO_URL : undefined),
    parityEnv: flags['parity-env'],
    provision: flags.provision,
    provisionMode,
    persona: flags.persona,
    severityGate: gate,
    playwrightMcpVersion: overrideRaw,
    mode,
    fbsIds,
  }, flags.package !== undefined && flags.url === undefined ? { ...deps, fetchImpl: refusePackageFetch(flags.package) } : deps);

  if (isRcfError(result)) {
    stderr.write(`${formatError(result, { verbose: true })}\n`);
    return exitForError(result);
  }

  const { report } = result;

  // The report is written ALWAYS, regardless of the gate (§3 rule 5).
  const writer = deps.writeFile ?? writeFile;
  if (flags.out) {
    try {
      await writer(resolvePath(cwd, flags.out), serialiseReport(report), 'utf8');
    } catch (err) {
      stderr.write(`[rcf-verify] unexpected failure: could not write report: ${err.message}\n`);
      return 1;
    }
  }

  // FBS-219: the Test-stage VerifyReport v1, the only file this verb
  // writes under rcf/verify-reports/.
  let verifyReport = null;
  if (verifyReportPath) {
    verifyReport = composeVerifyReport({
      report,
      fbsId: handFbsIds[0],
      headSha,
      target: flags.package !== undefined
        ? { kind: 'package', packageRef: flags.package }
        : urlTarget(flags),
      mode,
      hand: flags.hand,
      verifierId: flags['verifier-id'],
      rcfLiteVersion: await readOwnVersion(),
    });
    const absPath = resolvePath(cwd, verifyReportPath);
    try {
      await mkdir(dirname(absPath), { recursive: true });
      await writer(absPath, serialiseReport(verifyReport), 'utf8');
    } catch (err) {
      stderr.write(`[rcf-verify] unexpected failure: could not write verify report: ${err.message}\n`);
      return 1;
    }
  }

  // rcf-eval-node spec section 5.3: preflight-style print for EVAL
  // coverage. Runs on the report because the engine has already read
  // the chain; a report re-render carries runStats.evalCoverage so the
  // same line is reconstructable from the report artefact.
  const ec = report?.run?.runStats?.evalCoverage ?? report?.runStats?.evalCoverage ?? null;
  if (ec) {
    if ((ec.nonDeterministic ?? 0) === 0) {
      stderr.write('EVAL coverage: no nonDeterministic ACs on this chain\n');
    } else {
      stderr.write(
        `EVAL coverage: nonDeterministic=${ec.nonDeterministic}, covered=${ec.covered}, missing=${ec.missing}\n`,
      );
    }
  }

  const scopeCount = typeof report?.run?.scopeAcCount === 'number' ? ` (${report.run.scopeAcCount} ACs)` : '';
  stderr.write(`[rcf-verify] scope ${report?.run?.scope ?? 'chain'}${scopeCount}\n`);
  stderr.write(`[rcf-verify] verdict ${report.verdict} [${report.verdictAuthority}] -> ${flags.out ?? verifyReportPath}\n`);
  if (verifyReport) {
    const { verified, total } = verifyReport.runStats.counts;
    stdout.write(`verify report: ${verifyReportPath} ${verifyReport.verdict} ${verified}/${total}\n`);
  }

  // FBS-218: deterministic mode exits 0 only when every in-scope AC
  // passed its probe, 4 otherwise (a fail, a skip or a critique-only AC).
  if (mode === 'deterministic') {
    const counts = report?.run?.runStats?.counts;
    return counts && counts.total > 0 && counts.verified === counts.total ? 0 : 4;
  }

  // Exit code is the gate (§8.2). NOT-DEPLOYED / BLOCKED always trip.
  return gateTripped({ verdict: report.verdict, findings: report.findings, gate }) ? 5 : 0;
}
