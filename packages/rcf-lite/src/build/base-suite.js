// FBS-239 (US-20201, TAC-4158): `rcf build base-suite` runs the project's
// RCF suite at a clean committed HEAD and writes BaseSuiteRecord v1 to a
// named file outside the chain tree. The bundle backstop
// (src/build/backstop.js) reads that record; it never runs the suite.
//
// The command is --command or rcf/test-strength.json suiteCommand; a
// --command that differs from a declared suiteCommand is refused. Exit 0
// when recorded (whatever the suite result), 2 usage, 4 a dirty tree, 1 IO.

import { spawn, execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

import { recordSpawn } from '../audit/separation.js';

const execFileAsync = promisify(execFile);

export const NO_TAP_WARN = '[warn] base-suite: no TAP summary; green follows the exit code alone';
export const DIRTY = 'base-suite refused: working tree is dirty; record the suite on a committed base';

async function git(projectRoot, args) {
  recordSpawn('git', args);
  const { stdout } = await execFileAsync('git', args, { cwd: projectRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

/** rcf/test-strength.json suiteCommand, or null when none is declared. */
async function declaredSuiteCommand(projectRoot) {
  try {
    const doc = JSON.parse(await readFile(join(projectRoot, 'rcf', 'test-strength.json'), 'utf8'));
    return typeof doc?.suiteCommand === 'string' && doc.suiteCommand.trim() !== '' ? doc.suiteCommand : null;
  } catch {
    return null;
  }
}

/**
 * The TAP summary counts of a run's stdout ({ pass, fail, skip, todo,
 * cancelled }), or null when it carries none (no top-level # pass and
 * # fail lines).
 *
 * @param {string} text
 * @returns {{ pass: number, fail: number, skip: number, todo: number, cancelled: number }|null}
 */
export function tapSummary(text) {
  const counts = {};
  for (const m of text.matchAll(/^# (pass|fail|skipped|todo|cancelled) (\d+)\s*$/gm)) counts[m[1]] = Number(m[2]);
  if (counts.pass === undefined || counts.fail === undefined) return null;
  return { pass: counts.pass, fail: counts.fail, skip: counts.skipped ?? 0, todo: counts.todo ?? 0, cancelled: counts.cancelled ?? 0 };
}

/**
 * Run the suite command through the shell in the project root, under the
 * node that runs rcf (its directory first on PATH), so the record's node
 * field names the node the suite ran on. A nested node --test prints its
 * own output, not a report to an enclosing test run.
 */
function runSuite(projectRoot, command) {
  recordSpawn('sh', ['-c', command]);
  const env = { ...process.env, PATH: [dirname(process.execPath), process.env.PATH].filter(Boolean).join(delimiter) };
  delete env.NODE_TEST_CONTEXT;
  return new Promise((res) => {
    const child = spawn(command, { cwd: projectRoot, env, shell: true, stdio: ['ignore', 'pipe', 'inherit'] });
    const chunks = [];
    child.stdout.on('data', (c) => chunks.push(c));
    child.on('error', () => res({ exitCode: 127, stdout: Buffer.concat(chunks).toString('utf8') }));
    child.on('close', (code) => res({ exitCode: Number.isInteger(code) ? code : 1, stdout: Buffer.concat(chunks).toString('utf8') }));
  });
}

/**
 * `rcf build base-suite [--command "<suite>"] --out <file>`.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {string} args.cwd - where a relative --out resolves
 * @param {string|undefined} args.command
 * @param {string|undefined} args.out
 * @returns {Promise<{ code: number, out: string|null, err: string[] }>}
 */
export async function recordBaseSuite({ projectRoot, cwd, command, out }) {
  const usage = (message) => ({ code: 2, out: null, err: [`[error] usage ${message}`] });
  if (typeof out !== 'string' || out.trim() === '') return usage('build base-suite requires --out <file>');
  const outPath = resolve(cwd, out);
  const inChain = relative(join(projectRoot, 'rcf'), outPath);
  if (!inChain.startsWith('..') && !isAbsolute(inChain)) {
    return usage(`--out ${out} is inside rcf/; a base-suite record never lands in the chain tree`);
  }
  const declared = await declaredSuiteCommand(projectRoot);
  if (command !== undefined && declared !== null && command !== declared) return usage('--command differs from rcf/test-strength.json suiteCommand');
  const suite = command ?? declared;
  if (typeof suite !== 'string' || suite.trim() === '') {
    return usage('build base-suite requires --command "<suite>" (rcf/test-strength.json declares no suiteCommand)');
  }

  let head;
  let dirty;
  try {
    head = (await git(projectRoot, ['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
    dirty = (await git(projectRoot, ['status', '--porcelain'])).trim() !== '';
  } catch {
    return { code: 4, out: null, err: ['base-suite refused: no committed HEAD; record the suite on a committed base'] };
  }
  if (dirty) return { code: 4, out: null, err: [DIRTY] };

  const startedAt = new Date().toISOString();
  const run = await runSuite(projectRoot, suite);
  const finishedAt = new Date().toISOString();
  const tap = tapSummary(run.stdout);
  const green = run.exitCode === 0 && (tap === null || tap.fail === 0);
  const record = { version: 1, head, command: suite, exitCode: run.exitCode, tap, green, startedAt, finishedAt, node: process.version };
  try {
    await writeFile(outPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  } catch (err) {
    return { code: 1, out: null, err: [`[error] ioFailure build base-suite: --out write failed: ${err.message}`] };
  }
  const counts = tap ? `${tap.pass} pass, ${tap.fail} fail` : 'no TAP summary';
  return {
    code: 0,
    out: `base-suite: ${green ? 'green' : 'red'} at ${head.slice(0, 7)} (exit ${run.exitCode}, ${counts}) recorded to ${out}`,
    err: tap ? [] : [NO_TAP_WARN],
  };
}
