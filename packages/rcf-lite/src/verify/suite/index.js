// FBS-225 (US-19301, TAC-4151): suite-as-probe runner for package target
// mode. Installs a packed artefact in a scratch project under the OS
// temporary directory, stages the installed package with the bound test
// files' top-level directories beside it, runs each bound file with
// node --test and the TAP reporter, and parses the reporter output. Spawns
// only npm and node; the project tree is never written here.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { formatError, isRcfError } from '#core/errors';
import { walkTree } from '#core/store';

import { readChain } from '../chain/index.js';
import { resolveScope } from '../chain/scope.js';
import { readVerifyCatalog, selectProbe } from '../engine/catalog.js';
import { composeVerifyReport, suiteVerdict } from '../report/index.js';
import { boundTests, countResults, mapAcResults, suiteKey } from './map.js';

/** The profile package target mode stamps (rcf-lite-local, VerifyReport v1 only). */
export const PACKAGED_ARTEFACT_PROFILE = 'packagedArtefact';

const GZIP_MAGIC = [0x1f, 0x8b];

/**
 * True when the path names a regular file that starts with the gzip magic.
 *
 * @param {string} path
 * @returns {boolean}
 */
export function isGzipFile(path) {
  try {
    if (!statSync(path).isFile()) return false;
    const head = readFileSync(path).subarray(0, 2);
    return head.length === 2 && head[0] === GZIP_MAGIC[0] && head[1] === GZIP_MAGIC[1];
  } catch {
    return false;
  }
}

// Run a child to completion; stdout and stderr are captured, never rejects.
function runChild(command, args, { cwd, env }) {
  return new Promise((res) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d) => { stdout += d; });
    child.stderr.setEncoding('utf8').on('data', (d) => { stderr += d; });
    child.on('error', (err) => res({ code: 1, stdout, stderr: `${stderr}${err.message}\n` }));
    child.on('close', (code) => res({ code: code ?? 1, stdout, stderr }));
  });
}

/**
 * Install the tarball into a fresh scratch project under os.tmpdir().
 *
 * @param {object} p
 * @param {string} p.tgz - absolute path to the packed artefact
 * @param {boolean} [p.offline] - FBS-226: install from the local npm cache only
 * @param {NodeJS.ProcessEnv} [p.env]
 * @returns {Promise<{ scratch: string, command: string, exitCode: number, log: string, name: string|null, version: string|null }>}
 */
export async function installArtefact({ tgz, offline = false, env = process.env }) {
  const scratch = mkdtempSync(join(tmpdir(), 'rcf-suite-'));
  writeFileSync(join(scratch, 'package.json'), `${JSON.stringify({ name: 'rcf-suite-scratch', private: true }, null, 2)}\n`, 'utf8');
  const args = ['install', '--no-audit', '--no-fund', ...(offline ? ['--offline'] : []), tgz];
  const r = await runChild('npm', args, { cwd: scratch, env });
  let name = null;
  let version = null;
  if (r.code === 0) {
    const deps = JSON.parse(readFileSync(join(scratch, 'package.json'), 'utf8')).dependencies ?? {};
    name = Object.keys(deps)[0] ?? null;
    if (name) version = JSON.parse(readFileSync(join(scratch, 'node_modules', name, 'package.json'), 'utf8')).version ?? null;
  }
  return { scratch, command: `npm ${args.join(' ')}`, exitCode: r.code, log: `${r.stdout}${r.stderr}`, name, version };
}

/**
 * Copy the installed package to <scratch>/run and each bound test file's
 * top-level entry (for example test/) from the project beside it.
 *
 * @param {object} p
 * @param {string} p.scratch
 * @param {string} p.name - the installed package name
 * @param {string} p.projectRoot
 * @param {string[]} p.files - bound test files, relative to the project root
 * @returns {string} the run directory
 */
export function stageRun({ scratch, name, projectRoot, files }) {
  const runDir = join(scratch, 'run');
  cpSync(join(scratch, 'node_modules', name), runDir, { recursive: true });
  for (const top of new Set(files.map((f) => f.split('/')[0]))) {
    const from = join(projectRoot, top);
    if (existsSync(from)) cpSync(from, join(runDir, top), { recursive: true, force: true });
  }
  return runDir;
}

/**
 * Run one test file with node --test and the TAP reporter.
 *
 * @param {object} p
 * @param {string} p.runDir
 * @param {string} p.file
 * @param {NodeJS.ProcessEnv} [p.env]
 * @returns {Promise<{ code: number, tap: string }>}
 */
export async function runSuiteFile({ runDir, file, env = process.env }) {
  const childEnv = { ...env };
  // A nested runner that inherits the marker reports to its parent instead of printing TAP.
  delete childEnv.NODE_TEST_CONTEXT;
  const r = await runChild(process.execPath, ['--test', '--test-reporter=tap', file], { cwd: runDir, env: childEnv });
  return { code: r.code, tap: r.stdout };
}

// Undo the TAP reporter's escaping of `\` and `#` in test names.
function unescapeTitle(s) {
  return s.replace(/\\(.)/g, '$1');
}

/**
 * Parse node:test TAP output: every test line at any depth as
 * { ok, testNumber, title, directive, depth }, and the top-level summary
 * counts.
 *
 * @param {string} tap
 * @returns {{ tests: Array<{ ok: boolean, testNumber: number, title: string, directive: 'TODO'|'SKIP'|null, depth: number }>, summary: Record<string, number> }}
 */
export function parseTap(tap) {
  const tests = [];
  const summary = {};
  for (const line of tap.split('\n')) {
    const m = line.match(/^( *)(not ok|ok) (\d+) - (.*)$/);
    if (m) {
      const d = m[4].match(/^(.*?) # (TODO|SKIP)\b.*$/);
      // A `#` inside a title is escaped `\#`, so an unescaped ` # ` starts the directive.
      const raw = d && !d[1].endsWith('\\') ? d[1] : m[4];
      tests.push({
        ok: m[2] === 'ok',
        testNumber: Number(m[3]),
        title: unescapeTitle(raw),
        directive: d && raw === d[1] ? d[2] : null,
        depth: m[1].length / 4,
      });
      continue;
    }
    const s = line.match(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/);
    if (s) summary[s[1]] = Number(s[2]);
  }
  return { tests, summary };
}

/**
 * Package target mode end to end: read the chain, install and stage the
 * artefact, run every bound file, map the results and compose VerifyReport
 * v1. Returns the report and the evidence files (paths relative to the
 * report directory's <head12>/ folder); the caller writes them. Errors are
 * data: { code, message } with the CLI exit code.
 *
 * @param {object} p
 * @param {string} p.repo - chain source (the working directory when --repo is absent)
 * @param {string} p.fbsId
 * @param {string} p.headSha
 * @param {string} p.tgz - absolute path to the artefact
 * @param {string} p.evidenceDir - report-relative evidence directory, e.g. rcf/verify-reports/FBS-001/<head12>
 * @param {string} p.hand
 * @param {string|null} p.verifierId
 * @param {string} p.rcfLiteVersion
 * @param {boolean} [p.offline] - FBS-226: npm install --offline (install.registry offline)
 * @param {{ command: string, exitCode: number }} [p.pack] - FBS-226: the pack step of a packed run
 * @param {string|null} [p.servedSha] - FBS-226: HEAD on a packed run, null for a given tarball
 * @param {NodeJS.ProcessEnv} [p.env]
 * @returns {Promise<{ ok: true, verifyReport: object, evidence: Array<{ name: string, content: string }> } | { ok: false, code: number, message: string, evidence?: Array<{ name: string, content: string }> }>}
 */
export async function runSuiteAsProbe(p) {
  const startedAt = new Date().toISOString();
  const chain = await readChain({ repo: p.repo });
  if (isRcfError(chain)) return { ok: false, code: 3, message: formatError(chain, { verbose: true }) };
  const scope = resolveScope({ chain, fbsIds: [p.fbsId] });
  if (isRcfError(scope)) return { ok: false, code: 2, message: formatError(scope, { verbose: true }) };
  const { tree } = await walkTree({ projectRoot: chain.projectRoot });
  const catalog = await readVerifyCatalog(chain.projectRoot);
  if (isRcfError(catalog)) return { ok: false, code: 3, message: formatError(catalog, { verbose: true }) };

  const acs = scope.acs.map((ac) => ({ acId: ac.acId, probe: selectProbe(ac, catalog)?.probe ?? null }));
  const bound = boundTests({ testSuites: tree.testSuites, acIds: acs.map((a) => a.acId) });
  const env = p.env ?? process.env;

  const install = await installArtefact({ tgz: p.tgz, offline: p.offline === true, env });
  try {
    // FBS-226 (AC-19302-3): the install log is written, the report JSON is not.
    if (install.exitCode !== 0 || !install.name) {
      return {
        ok: false,
        code: 1,
        message: `verify run: install failed (npm exit ${install.exitCode}); log ${p.evidenceDir}/install.log`,
        evidence: [{ name: 'install.log', content: install.log }],
      };
    }
    const suites = [];
    for (const b of bound) {
      if (!suites.some((s) => s.tsId === b.tsId && s.file === b.file)) suites.push({ tsId: b.tsId, file: b.file });
    }
    const runDir = stageRun({ scratch: install.scratch, name: install.name, projectRoot: chain.projectRoot, files: suites.map((s) => s.file) });
    const runs = new Map();
    const evidence = [{ name: 'install.log', content: install.log }];
    const suiteRows = [];
    for (const s of suites) {
      const r = await runSuiteFile({ runDir, file: s.file, env });
      const parsed = parseTap(r.tap);
      runs.set(suiteKey(s.tsId, s.file), parsed);
      // One <TS id>.tap per suite; a TS spanning several files numbers the later ones.
      const nth = suites.filter((o) => o.tsId === s.tsId).indexOf(s);
      const name = nth === 0 ? `${s.tsId}.tap` : `${s.tsId}-${nth + 1}.tap`;
      evidence.push({ name, content: r.tap });
      const sum = parsed.summary;
      suiteRows.push({
        testSuite: s.tsId, file: s.file, tests: sum.tests ?? 0, pass: sum.pass ?? 0, fail: sum.fail ?? 0,
        skipped: sum.skipped ?? 0, todos: sum.todo ?? 0, outputPath: `${p.evidenceDir}/${name}`,
      });
    }

    const perAc = mapAcResults({ acs, bound, runs });
    const counts = countResults(perAc);
    const verdict = suiteVerdict(counts);
    const verifyReport = composeVerifyReport({
      report: {
        run: { profile: PACKAGED_ARTEFACT_PROFILE, startedAt, finishedAt: new Date().toISOString(), runStats: { counts } },
        verdict,
        verdictAuthority: 'correctness',
        perAc,
      },
      fbsId: p.fbsId,
      headSha: p.headSha,
      target: {
        kind: 'package', packageRef: basename(p.tgz), name: install.name, version: install.version,
        sha256: createHash('sha256').update(readFileSync(p.tgz)).digest('hex'), servedSha: p.servedSha ?? null,
      },
      mode: 'deterministic',
      hand: p.hand,
      verifierId: p.verifierId,
      rcfLiteVersion: p.rcfLiteVersion,
      method: 'suiteAsProbe',
      pack: p.pack,
      install: {
        command: install.command, exitCode: install.exitCode, logPath: `${p.evidenceDir}/install.log`,
        registry: p.offline === true ? 'offline' : 'default',
      },
      suites: suiteRows,
    });
    return { ok: true, verifyReport, evidence };
  } finally {
    rmSync(install.scratch, { recursive: true, force: true });
  }
}
