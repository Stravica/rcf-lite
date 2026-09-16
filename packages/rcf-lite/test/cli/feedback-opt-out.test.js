// FBS-184 slice 5 CLI tests for rcf feedback opt-out / opt-in and
// the env-precedence quiet-rule branches (design 3.5 + section 8).
//
// Binds AC-16102-1 (opt-out writes ask: false; hook goes silent;
// add / preview keep working) and AC-16102-2 (env DISABLE and env
// ASK precedence over the file, and DISABLE turning `add` into a
// no-op).

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

async function scaffoldReady() {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-optout-'));
  await initProject({ projectRoot: tmp, projectName: 'OptOutTest' });
  await writeFile(join(tmp, '.gitignore'), '.rcf/feedback/\n', 'utf8');
  return tmp;
}

async function runBin(cwd, args, extraEnv = {}) {
  const env = { ...process.env, CI: '1', RCF_FEEDBACK_SESSION_ID: 'opt-test', ...extraEnv };
  try {
    const { stdout, stderr } = await exec(process.execPath, [bin, ...args], {
      cwd, encoding: 'utf8', env,
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

async function runHook(cwd, sub, harness, payload, extraEnv = {}) {
  const env = { ...process.env, CI: '1', ...extraEnv };
  return new Promise((resolveP) => {
    const cp = execFile(process.execPath, [bin, 'feedback', 'hook', sub, '--harness', harness], {
      cwd, env, encoding: 'utf8',
    }, (err, stdout, stderr) => {
      resolveP({ code: err?.code ?? 0, stdout: stdout ?? '', stderr: stderr ?? '' });
    });
    cp.stdin.write(JSON.stringify(payload));
    cp.stdin.end();
  });
}

async function addOne(cwd) {
  return runBin(cwd, [
    'feedback', 'add',
    '--kind', 'core',
    '--target', 'define validate',
    '--anchor', 'REQ-155',
    '--class', 'docs-mismatch',
    '--severity', 'blocker',
    '--title', 'x',
    '--body', 'b',
    '--evidence', 'e',
    '--ask-now',
  ]);
}

// -- AC-16102-1 -----------------------------------------------------------

test('AC-16102-1: opt-out writes ask: false and preserves defaults; the hook goes silent', async () => {
  const cwd = await scaffoldReady();
  await addOne(cwd);
  const r = await runBin(cwd, ['feedback', 'opt-out']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /rcf\/feedback-settings\.json.*ask: false/);
  const settings = JSON.parse(await readFile(join(cwd, 'rcf/feedback-settings.json'), 'utf8'));
  assert.equal(settings.ask, false);
  assert.equal(settings.settingsVersion, 1);
  assert.equal(settings.quietMinutes, 15);
  assert.deepEqual(settings.redaction, { allowHosts: [] });

  // Hook goes silent even with a pending --ask-now entry.
  const hook = await runHook(cwd, 'stop', 'claude-code', {
    session_id: 'silent-A', cwd: '.', hook_event_name: 'Stop', stop_hook_active: false,
  });
  assert.equal(hook.code, 0);
  assert.equal(hook.stderr, '');

  // add / preview keep working (hand-driven flow under ask: false).
  const another = await addOne(cwd);
  assert.equal(another.code, 0);
  const preview = await runBin(cwd, ['feedback', 'preview']);
  assert.equal(preview.code, 0);
  assert.match(preview.stdout, /title:/);
});

test('AC-16102-1: opt-in restores ask true and preserves other fields', async () => {
  const cwd = await scaffoldReady();
  await runBin(cwd, ['feedback', 'opt-out']);
  const preSettings = JSON.parse(await readFile(join(cwd, 'rcf/feedback-settings.json'), 'utf8'));
  assert.equal(preSettings.ask, false);
  const r = await runBin(cwd, ['feedback', 'opt-in']);
  assert.equal(r.code, 0);
  const settings = JSON.parse(await readFile(join(cwd, 'rcf/feedback-settings.json'), 'utf8'));
  assert.equal(settings.ask, true);
  assert.equal(settings.quietMinutes, 15);
});

// -- AC-16102-2 -----------------------------------------------------------

test('AC-16102-2: RCF_FEEDBACK_DISABLE=1 makes `add` a no-op that prints the disabled line', async () => {
  const cwd = await scaffoldReady();
  const res = await addOneWithEnv(cwd, { RCF_FEEDBACK_DISABLE: '1' });
  assert.equal(res.code, 0);
  assert.match(res.stdout, /^feedback disabled by env\n$/);
  await assert.rejects(readFile(join(cwd, '.rcf/feedback/entries.jsonl'), 'utf8'), { code: 'ENOENT' });
});

test('AC-16102-2: RCF_FEEDBACK_ASK=0 keeps add working, silences the hook', async () => {
  const cwd = await scaffoldReady();
  await addOne(cwd);
  const hook = await runHook(cwd, 'stop', 'claude-code', {
    session_id: 'env-ask-off', cwd: '.', hook_event_name: 'Stop', stop_hook_active: false,
  }, { RCF_FEEDBACK_ASK: '0' });
  assert.equal(hook.code, 0);
  assert.equal(hook.stderr, '');
});

test('AC-16102-2: env DISABLE > env ASK=0 > file ask false > file ask true (precedence)', async () => {
  const cwd = await scaffoldReady();
  await addOne(cwd);
  // Base: no env, file default -> hook asks.
  const base = await runHook(cwd, 'stop', 'claude-code', {
    session_id: 'prec-A', cwd: '.', hook_event_name: 'Stop', stop_hook_active: false,
  });
  assert.equal(base.code, 2);
  // File ask: false -> hook silent.
  await runBin(cwd, ['feedback', 'opt-out']);
  const withFile = await runHook(cwd, 'stop', 'claude-code', {
    session_id: 'prec-B', cwd: '.', hook_event_name: 'Stop', stop_hook_active: false,
  });
  assert.equal(withFile.code, 0);
  assert.equal(withFile.stderr, '');
  // Now flip file back to ask: true, but pass env ASK=0: still silent.
  await runBin(cwd, ['feedback', 'opt-in']);
  const withEnvOff = await runHook(cwd, 'stop', 'claude-code', {
    session_id: 'prec-C', cwd: '.', hook_event_name: 'Stop', stop_hook_active: false,
  }, { RCF_FEEDBACK_ASK: '0' });
  assert.equal(withEnvOff.code, 0);
  // DISABLE outranks both.
  const withDisable = await runHook(cwd, 'stop', 'claude-code', {
    session_id: 'prec-D', cwd: '.', hook_event_name: 'Stop', stop_hook_active: false,
  }, { RCF_FEEDBACK_DISABLE: '1' });
  assert.equal(withDisable.code, 0);
});

test('AC-16102-2: status reports the opt-out source verbatim', async () => {
  const cwd = await scaffoldReady();
  await runBin(cwd, ['feedback', 'opt-out']);
  const r = await runBin(cwd, ['feedback', 'status', '--json']);
  assert.equal(r.code, 0);
  const s = JSON.parse(r.stdout);
  assert.equal(s.optOut, true);
  assert.equal(s.optOutSource, 'file:rcf/feedback-settings.json');
  const r2 = await runBin(cwd, ['feedback', 'status', '--json'], { RCF_FEEDBACK_ASK: '0' });
  const s2 = JSON.parse(r2.stdout);
  assert.equal(s2.optOutSource, 'env:RCF_FEEDBACK_ASK=0');
  const r3 = await runBin(cwd, ['feedback', 'status', '--json'], { RCF_FEEDBACK_DISABLE: '1' });
  const s3 = JSON.parse(r3.stdout);
  assert.equal(s3.optOutSource, 'env:RCF_FEEDBACK_DISABLE');
});

async function addOneWithEnv(cwd, env) {
  return runBin(cwd, [
    'feedback', 'add',
    '--kind', 'core',
    '--target', 'define validate',
    '--anchor', 'REQ-155',
    '--class', 'docs-mismatch',
    '--severity', 'blocker',
    '--title', 'x',
    '--body', 'b',
    '--evidence', 'e',
    '--ask-now',
  ], env);
}
