// FBS-238 (US-20101, US-20102, TAC-4157): the release Verify run. Resolves
// the release scope, runs only the bound e2e cases of the in-scope live
// external criteria plus the declared smoke suites against the target (a
// URL, or a package installed cold), and composes ReleaseVerifyReport v1.
// Writes nothing in the project; the CLI writes the report and the
// statuses, and only with --record. Spawns git, npm and node only.

import { createHash } from 'node:crypto';
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { splitTestPointer, walkTree } from '#core/store';

import { parseTap } from '../suite/index.js';
import { packDirectory } from '../suite/pack.js';
import { coldScratch, installCold, runChild } from './cold.js';
import { composeReleaseReport } from './report.js';
import { changedSince, resolveReleaseScope } from './scope.js';

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Run each file once with node --test, selecting only the named cases.
 *
 * @param {object} p
 * @param {string} p.runDir
 * @param {string[]} p.pointers - test pointers (file::title)
 * @param {NodeJS.ProcessEnv} p.env
 * @returns {Promise<Map<string, ReturnType<typeof parseTap>>>} parsed TAP by file
 */
export async function runCases({ runDir, pointers, env }) {
  const byFile = new Map();
  for (const pointer of pointers) {
    const { file, testName } = splitTestPointer(pointer);
    const titles = byFile.get(file) ?? new Set();
    if (testName) titles.add(testName);
    byFile.set(file, titles);
  }
  const childEnv = { ...env };
  // A nested runner that inherits the marker reports to its parent instead of printing TAP.
  delete childEnv.NODE_TEST_CONTEXT;
  const runs = new Map();
  for (const [file, titles] of byFile) {
    const patterns = [...titles].map((t) => `--test-name-pattern=(?:^| )${escapeRegExp(t)}$`);
    const r = await runChild(process.execPath, ['--test', '--test-reporter=tap', ...patterns, file], { cwd: runDir, env: childEnv });
    runs.set(file, parseTap(r.stdout));
  }
  return runs;
}

// pass when the pointer's case was reported ok with no directive, else fail.
function caseResult(runs, pointer) {
  const { file, testName } = splitTestPointer(pointer);
  let found = null;
  for (const t of runs.get(file)?.tests ?? []) {
    if (t.title === testName && (!found || t.depth < found.depth)) found = t;
  }
  return found && found.ok && !found.directive ? 'pass' : 'fail';
}

/**
 * Stage the installed package at <install>/run (its dependencies resolve
 * from <install>/node_modules) with the project's copy of each test file's
 * top-level directory beside it.
 */
function stageInstalled({ install, projectRoot, files }) {
  const runDir = join(install.dir, 'run');
  cpSync(join(install.dir, 'node_modules', install.name), runDir, { recursive: true });
  for (const top of new Set(files.map((f) => f.split('/')[0]))) {
    const from = join(projectRoot, top);
    if (existsSync(from)) cpSync(from, join(runDir, top), { recursive: true, force: true });
  }
  return runDir;
}

/**
 * The release Verify, end to end. Errors are data: { ok: false, code, message }.
 *
 * @param {object} p
 * @param {string} p.projectRoot
 * @param {string} p.release - the label
 * @param {string} p.since - full sha
 * @param {string} p.head - full sha
 * @param {string[]} p.smokeSuites - TS ids
 * @param {{ url?: string, artefact?: string, packageDir?: { top: string, prefix: string } }} p.target
 * @param {NodeJS.ProcessEnv} [p.env]
 * @returns {Promise<{ ok: true, report: object } | { ok: false, code: number, message: string }>}
 */
export async function runReleaseVerify({ projectRoot, release, since, head, smokeSuites, target, env = process.env }) {
  const startedAt = new Date().toISOString();
  const { tree } = await walkTree({ projectRoot });
  const scope = resolveReleaseScope({ tree, ...changedSince({ cwd: projectRoot, since, head }) });
  const suites = new Map((tree.testSuites ?? []).map((ts) => [ts.id, ts]));
  const smokePointers = smokeSuites.map((id) => (suites.get(id)?.testCases ?? []).map((tc) => tc.testPointer).filter((p) => typeof p === 'string'));
  const pointers = [...scope.rows.flatMap((r) => r.tests.map((t) => t.testPointer)), ...smokePointers.flat()];

  let runDir = projectRoot;
  let runEnv = { ...env, RCF_TARGET_URL: target.url };
  let reportTarget = { kind: 'url', url: target.url };
  let scratch = null;
  let packScratch = null;
  try {
    if (target.url === undefined) {
      const cold = coldScratch(env);
      scratch = cold.scratch;
      runEnv = cold.env;
      let tgz = target.artefact;
      if (target.packageDir) {
        const pack = await packDirectory({ ...target.packageDir, headSha: head, env: cold.env });
        packScratch = pack.scratch;
        if (!pack.tgz) return { ok: false, code: 1, message: `verify run: pack failed (npm exit ${pack.exitCode}): ${pack.command}\n${pack.log}` };
        tgz = pack.tgz;
      }
      const install = await installCold({ scratch, env: cold.env, tgz });
      if (install.exitCode !== 0 || !install.name) {
        return { ok: false, code: 1, message: `verify run: install failed (npm exit ${install.exitCode}): ${install.command}\n${install.log}` };
      }
      runDir = stageInstalled({ install, projectRoot, files: pointers.map((p) => splitTestPointer(p).file) });
      reportTarget = {
        kind: 'package', name: install.name, version: install.version,
        sha256: createHash('sha256').update(readFileSync(tgz)).digest('hex'), cold: true,
      };
    }
    const runs = await runCases({ runDir, pointers, env: runEnv });
    const perAc = scope.rows.map((r) => {
      const tests = r.tests.map((t) => t.testPointer);
      const result = r.blocked ? 'blocked' : (tests.every((p) => caseResult(runs, p) === 'pass') ? 'pass' : 'fail');
      return { acId: r.acId, fbsId: r.fbsId, result, reason: r.blocked, tests };
    });
    const smoke = smokeSuites.map((tsId, i) => {
      const tests = smokePointers[i];
      return { tsId, result: tests.length > 0 && tests.every((p) => caseResult(runs, p) === 'pass') ? 'pass' : 'fail', tests };
    });
    return {
      ok: true,
      report: composeReleaseReport({ release, head, since, target: reportTarget, scope, smokeSuites, perAc, smoke, startedAt }),
    };
  } finally {
    if (packScratch) rmSync(packScratch, { recursive: true, force: true });
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }
}
