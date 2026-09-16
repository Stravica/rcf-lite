// FBS-180 slice 1 CLI tests for `rcf feedback add`.
//
// Binds AC-15501-1 (happy path writes one JSONL line and stamps env),
// AC-15501-2 (gitignore refusal), AC-15501-3 (blueprint unresolved
// exits 3 but still records), AC-15501-4 (enum/size validation on
// class, severity, title, body), and AC-15501-5 (blueprint-specific
// env stamps under --kind blueprint).
//
// Every run drives bin/rcf.js in a mkdtemp project (`initProject`),
// which is the repo convention. Network is refused by construction:
// slice 1 does not shell out to anything.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { initProject } from '#core/store/init.js';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, '..', '..', 'bin', 'rcf.js');

/** @param {string} cwd @param {string[]} args @returns {Promise<{code:number,stdout:string,stderr:string}>} */
async function runBin(cwd, args = []) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [bin, ...args], {
      cwd, encoding: 'utf8', env: { ...process.env, CI: '1', RCF_FEEDBACK_SESSION_ID: 'test-session' },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

/**
 * Scaffold a project WITH the feedback gitignore entry.
 * The managed-block writer runs inside `rcf init`, so we mimic the
 * outcome by writing the literal `.rcf/feedback/` line into .gitignore
 * (the pre-write check is coarse: any of four literal coverages passes).
 */
async function scaffoldReady() {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-feedback-add-'));
  await initProject({ projectRoot: tmp, projectName: 'FeedbackAdd' });
  await writeFile(join(tmp, '.gitignore'), '.rcf/feedback/\n', 'utf8');
  return tmp;
}

async function scaffoldNoIgnore() {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-feedback-add-noignore-'));
  await initProject({ projectRoot: tmp, projectName: 'FeedbackNoIgnore' });
  return tmp;
}

// -- AC-15501-1 -----------------------------------------------------------

test('AC-15501-1: rcf feedback add writes one JSONL line and stamps env', async () => {
  const tmp = await scaffoldReady();
  const { code, stdout } = await runBin(tmp, [
    'feedback', 'add',
    '--kind', 'core',
    '--target', 'define validate',
    '--anchor', 'REQ-155',
    '--class', 'docs-mismatch',
    '--severity', 'minor',
    '--title', 'A finding',
    '--body', 'The body.',
    '--evidence', 'rcf define validate',
  ]);
  assert.equal(code, 0);
  assert.match(stdout, /^recorded fb-\d{8}-[0-9a-f]{12} \(1 pending\)\. Nothing sent\.\n$/);
  const jsonl = await readFile(join(tmp, '.rcf/feedback/entries.jsonl'), 'utf8');
  const lines = jsonl.split('\n').filter(Boolean);
  assert.equal(lines.length, 1, 'expected exactly one JSONL line');
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.kind, 'core');
  assert.equal(entry.symptomClass, 'docs-mismatch');
  assert.equal(entry.severity, 'minor');
  assert.equal(entry.title, 'A finding');
  assert.equal(entry.body, 'The body.');
  assert.deepEqual(entry.evidence, [{ kind: 'command', value: 'rcf define validate' }]);
  assert.ok(entry.environment.rcfLiteVersion, 'rcfLiteVersion stamped');
  assert.ok(entry.environment.nodeVersion, 'nodeVersion stamped');
  assert.ok(entry.environment.platform, 'platform stamped');
  assert.equal(entry.sessionId, 'test-session');
  assert.equal(entry.status, 'pending');
  assert.equal(entry.destination.repo, 'Stravica/rcf-lite');
});

// -- AC-15501-2 -----------------------------------------------------------

test('AC-15501-2: add refuses when .gitignore does not cover .rcf/feedback/', async () => {
  const tmp = await scaffoldNoIgnore();
  const { code, stderr } = await runBin(tmp, [
    'feedback', 'add',
    '--kind', 'core',
    '--target', 'define validate',
    '--class', 'docs-mismatch',
    '--severity', 'minor',
    '--title', 't',
    '--body', 'b',
    '--evidence', 'x',
  ]);
  assert.equal(code, 2);
  assert.match(stderr, /no \.gitignore in project root/);
  assert.match(stderr, /rcf doctor --fix/);
  await assert.rejects(readFile(join(tmp, '.rcf/feedback/entries.jsonl'), 'utf8'), { code: 'ENOENT' });
});

test('AC-15501-2: --force bypasses the refusal', async () => {
  const tmp = await scaffoldNoIgnore();
  const { code } = await runBin(tmp, [
    'feedback', 'add',
    '--kind', 'core',
    '--target', 'define validate',
    '--class', 'docs-mismatch',
    '--severity', 'minor',
    '--title', 't',
    '--body', 'b',
    '--evidence', 'x',
    '--force',
  ]);
  assert.equal(code, 0);
  const jsonl = await readFile(join(tmp, '.rcf/feedback/entries.jsonl'), 'utf8');
  assert.equal(jsonl.split('\n').filter(Boolean).length, 1);
});

// -- AC-15501-3 (F-7 wording) --------------------------------------------

test('AC-15501-3: blueprint target that does not resolve exits 3 and records unresolved', async () => {
  const tmp = await scaffoldReady();
  const { code, stdout, stderr } = await runBin(tmp, [
    'feedback', 'add',
    '--kind', 'blueprint',
    '--target', 'no-such-blueprint',
    '--anchor', 'AC-1-1',
    '--class', 'validate-fails',
    '--severity', 'major',
    '--title', 'x',
    '--body', 'y',
    '--evidence', 'z',
  ]);
  assert.equal(code, 3, 'exit 3 is the design 3.1 destination-cannot-be-resolved branch');
  assert.match(stdout, /^recorded fb-/, 'entry is still recorded');
  assert.match(stderr, /destination unresolved: no-such-blueprint/);
  const jsonl = await readFile(join(tmp, '.rcf/feedback/entries.jsonl'), 'utf8');
  const entry = JSON.parse(jsonl.trim().split('\n')[0]);
  assert.equal(entry.destination.reason, 'unresolved');
  assert.equal(entry.destination.repo, undefined);
});

// -- AC-15501-4 -----------------------------------------------------------

test('AC-15501-4: invalid --class exits 2 naming the enum', async () => {
  const tmp = await scaffoldReady();
  const { code, stderr } = await runBin(tmp, [
    'feedback', 'add',
    '--kind', 'core', '--target', 'define validate',
    '--class', 'not-a-real-class',
    '--severity', 'minor',
    '--title', 't', '--body', 'b', '--evidence', 'x',
  ]);
  assert.equal(code, 2);
  assert.match(stderr, /--class must be one of/);
});

test('AC-15501-4: invalid --severity exits 2', async () => {
  const tmp = await scaffoldReady();
  const { code, stderr } = await runBin(tmp, [
    'feedback', 'add',
    '--kind', 'core', '--target', 'define validate',
    '--class', 'docs-mismatch', '--severity', 'urgent',
    '--title', 't', '--body', 'b', '--evidence', 'x',
  ]);
  assert.equal(code, 2);
  assert.match(stderr, /--severity must be one of/);
});

test('AC-15501-4: oversize --title exits 2', async () => {
  const tmp = await scaffoldReady();
  const oversize = 'x'.repeat(121);
  const { code, stderr } = await runBin(tmp, [
    'feedback', 'add',
    '--kind', 'core', '--target', 'define validate',
    '--class', 'docs-mismatch', '--severity', 'minor',
    '--title', oversize, '--body', 'b', '--evidence', 'x',
  ]);
  assert.equal(code, 2);
  assert.match(stderr, /--title exceeds 120 character cap/);
});

test('AC-15501-4: oversize --body exits 2', async () => {
  const tmp = await scaffoldReady();
  const big = 'x'.repeat(8 * 1024 + 1);
  const { code, stderr } = await runBin(tmp, [
    'feedback', 'add',
    '--kind', 'core', '--target', 'define validate',
    '--class', 'docs-mismatch', '--severity', 'minor',
    '--title', 't', '--body', big, '--evidence', 'x',
  ]);
  assert.equal(code, 2);
  assert.match(stderr, /--body exceeds 8192 byte cap/);
});

// -- AC-15501-5 (F-2 blueprint stamps) -----------------------------------

test('AC-15501-5: blueprint entries stamp version, libraryPrefix, libraryRef and resolvedSha from the manifest record', async () => {
  const tmp = await scaffoldReady();
  // Seed a manifest record for a library blueprint (git-pin) and a shelf blueprint.
  const manifestPath = join(tmp, 'rcf/manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.blueprints = [
    {
      slug: 'wsd-std-error-envelope',
      version: '1.2.0',
      libraryPrefix: 'wsd',
      libraryRef: '1.4.0',
      pin: { sourceKind: 'git', resolvedSha: '9c2eabcd1234' },
    },
    {
      slug: 'application-forms-wizard',
      version: '0.3.0',
    },
  ];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const runOne = async (target) => runBin(tmp, [
    'feedback', 'add',
    '--kind', 'blueprint', '--target', target,
    '--anchor', 'AC-1-1',
    '--class', 'docs-mismatch', '--severity', 'minor',
    '--title', target, '--body', 'body', '--evidence', 'ev',
  ]);
  const a = await runOne('wsd:std-error-envelope');
  assert.equal(a.code, 0, `library-pin blueprint should resolve: ${a.stderr}`);
  const b = await runOne('application-forms-wizard');
  assert.equal(b.code, 0, `shelf blueprint should resolve: ${b.stderr}`);
  const c = await runBin(tmp, [
    'feedback', 'add',
    '--kind', 'core', '--target', 'define validate',
    '--class', 'docs-mismatch', '--severity', 'minor',
    '--title', 'core', '--body', 'body', '--evidence', 'ev',
  ]);
  assert.equal(c.code, 0);

  const entries = (await readFile(join(tmp, '.rcf/feedback/entries.jsonl'), 'utf8'))
    .split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const byTitle = new Map(entries.map((e) => [e.title, e]));

  const lib = byTitle.get('wsd:std-error-envelope');
  assert.equal(lib.target.blueprintVersion, '1.2.0');
  assert.equal(lib.target.libraryPrefix, 'wsd');
  assert.equal(lib.target.libraryRef, '1.4.0');
  assert.equal(lib.target.resolvedSha, '9c2eabcd1234');

  const shelf = byTitle.get('application-forms-wizard');
  assert.equal(shelf.target.blueprintVersion, '0.3.0');
  assert.equal(shelf.target.libraryPrefix, null);
  assert.equal(shelf.target.libraryRef, null);

  const core = byTitle.get('core');
  assert.equal(core.target.blueprintVersion, undefined);
  assert.equal(core.target.libraryPrefix, undefined);
});

// -- review fix round (2026-09-16 slice 1-3 review) ---------------------

async function runBinWithEnv(cwd, args, extraEnv) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [bin, ...args], {
      cwd, encoding: 'utf8', env: { ...process.env, CI: '1', RCF_FEEDBACK_SESSION_ID: 'test-session', ...extraEnv },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

test('F-slice-1-02: RCF_FEEDBACK_DISABLE=1 makes add a no-op that prints feedback disabled by env, no entry persisted', async () => {
  const tmp = await scaffoldReady();
  const res = await runBinWithEnv(tmp, [
    'feedback', 'add',
    '--kind', 'core', '--target', 'define validate',
    '--anchor', 'REQ-155', '--class', 'docs-mismatch', '--severity', 'minor',
    '--title', 't', '--body', 'b', '--evidence', 'x',
  ], { RCF_FEEDBACK_DISABLE: '1' });
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.stdout, /feedback disabled by env/);
  // No entries file should have been created.
  const { readFile } = await import('node:fs/promises');
  await assert.rejects(readFile(join(tmp, '.rcf/feedback/entries.jsonl'), 'utf8'));
});

test('F-slice-1-05: harness inference returns unknown (not other) when neither Claude Code nor Codex env is set; CLAUDECODE=true does not qualify (only =1)', async () => {
  const tmp = await scaffoldReady();
  const runWithHarnessEnv = async (env) => {
    const strippedEnv = { ...process.env, ...env };
    for (const k of Object.keys(strippedEnv)) {
      if (k.startsWith('CODEX_')) delete strippedEnv[k];
      if (k === 'CLAUDECODE' && env.CLAUDECODE == null) delete strippedEnv[k];
    }
    strippedEnv.CI = '1';
    strippedEnv.RCF_FEEDBACK_SESSION_ID = 'test-session';
    const { stdout, stderr } = await exec(process.execPath, [bin,
      'feedback', 'add',
      '--kind', 'core', '--target', 'define validate',
      '--anchor', 'REQ-155', '--class', 'docs-mismatch', '--severity', 'minor',
      '--title', `t-${Date.now()}-${Math.random()}`,
      '--body', 'b', '--evidence', 'x',
    ], { cwd: tmp, encoding: 'utf8', env: strippedEnv }).catch((err) => ({ stdout: err.stdout ?? '', stderr: err.stderr ?? '' }));
    void stderr;
    void stdout;
  };
  await runWithHarnessEnv({});
  await runWithHarnessEnv({ CLAUDECODE: 'true' });
  await runWithHarnessEnv({ CLAUDECODE: '1' });
  const entries = (await readFile(join(tmp, '.rcf/feedback/entries.jsonl'), 'utf8'))
    .split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const [unset, trueString, one] = entries;
  assert.equal(unset.environment.harness, 'unknown', 'unset env must infer unknown');
  assert.equal(trueString.environment.harness, 'unknown', "CLAUDECODE='true' must NOT count (design 3.6 pins =1)");
  assert.equal(one.environment.harness, 'claude-code', "CLAUDECODE='1' must infer claude-code");
});

test('F-slice-1-12: persisted entry includes the fingerprint that preview and submit would compute (design 4.1 shape)', async () => {
  const tmp = await scaffoldReady();
  await runBin(tmp, [
    'feedback', 'add',
    '--kind', 'core', '--target', 'define validate',
    '--anchor', 'REQ-155', '--class', 'docs-mismatch', '--severity', 'minor',
    '--title', 'x', '--body', 'y', '--evidence', 'z',
  ]);
  const entries = (await readFile(join(tmp, '.rcf/feedback/entries.jsonl'), 'utf8'))
    .split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(entries.length, 1);
  assert.ok(/^[0-9a-f]{12}$/.test(entries[0].fingerprint ?? ''), `expected 12-hex fingerprint, got ${entries[0].fingerprint}`);
});
