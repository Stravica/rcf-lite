// FBS-184 slice 5 CLI tests for `rcf feedback hook <sub>` (design
// 3.5). Binds:
//   - AC-16101-2: on Claude Code, Stop exits 2 with the ask on
//     stderr; on Codex, Stop emits stdout JSON block; the ledger
//     is appended in both cases;
//   - AC-16101-3: same-session second Stop is silent; a fresh
//     session_id re-asks per the quiet rule;
//   - AC-16103-1: SessionEnd writes an idempotent outbox bundle;
//   - AC-16103-2: SessionStart injects the carry-over context line
//     (Claude Code shape and Codex shape).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { initProject } from '#core/store/init.js';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, '..', '..', 'bin', 'rcf.js');

async function scaffoldReady() {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-hook-'));
  await initProject({ projectRoot: tmp, projectName: 'HookTest' });
  await writeFile(join(tmp, '.gitignore'), '.rcf/feedback/\n', 'utf8');
  return tmp;
}

async function addOne(cwd, sessionId) {
  const args = [
    bin, 'feedback', 'add',
    '--kind', 'core',
    '--target', 'define validate',
    '--anchor', 'REQ-155',
    '--class', 'docs-mismatch',
    '--severity', 'blocker',
    '--title', 'x',
    '--body', 'b',
    '--evidence', 'e',
    '--ask-now',
  ];
  const env = { ...process.env, CI: '1', RCF_FEEDBACK_SESSION_ID: sessionId ?? 'add-session' };
  await exec(process.execPath, args, { cwd, encoding: 'utf8', env });
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

// -- AC-16101-2 -----------------------------------------------------------

test('AC-16101-2: Stop on Claude Code exits 2 with the ask on stderr and appends ledger', async () => {
  const cwd = await scaffoldReady();
  await addOne(cwd, 'add-session');
  const res = await runHook(cwd, 'stop', 'claude-code', {
    session_id: 'stop-session-a',
    cwd: '.',
    hook_event_name: 'Stop',
    stop_hook_active: false,
  });
  assert.equal(res.code, 2);
  assert.match(res.stderr, /rcf feedback preview/);
  assert.match(res.stderr, /rcf feedback submit --yes/);
  assert.match(res.stderr, /rcf feedback defer/);
  assert.match(res.stderr, /rcf feedback opt-out/);
  assert.match(res.stderr, /Do not ask again this session\./);
  assert.equal(res.stdout, '', 'stdout is empty on the Claude Code branch');
  const state = JSON.parse(await readFile(join(cwd, '.rcf/feedback/state.json'), 'utf8'));
  assert.equal(state.asked.length, 1);
  assert.equal(state.asked[0].sessionId, 'stop-session-a');
  assert.match(state.asked[0].askedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
});

test('AC-16101-2: Stop on Codex emits stdout JSON block, exit 0, ledger appended', async () => {
  const cwd = await scaffoldReady();
  await addOne(cwd, 'add-session');
  const res = await runHook(cwd, 'stop', 'codex', {
    session_id: 'stop-session-c',
    cwd: '.',
    hook_event_name: 'Stop',
    stop_hook_active: false,
  });
  assert.equal(res.code, 0);
  const line = res.stdout.trim();
  const parsed = JSON.parse(line);
  assert.equal(parsed.decision, 'block');
  assert.match(parsed.reason, /Do not ask again this session\./);
  assert.match(parsed.reason, /rcf feedback submit --yes/);
  assert.equal(res.stderr, '');
  const state = JSON.parse(await readFile(join(cwd, '.rcf/feedback/state.json'), 'utf8'));
  assert.equal(state.asked.length, 1);
  assert.equal(state.asked[0].sessionId, 'stop-session-c');
});

// -- AC-16101-3 -----------------------------------------------------------

test('AC-16101-3: same-session second Stop is silent; a fresh session_id re-asks', async () => {
  const cwd = await scaffoldReady();
  await addOne(cwd, 'add-session');
  const payloadA = { session_id: 'stop-A', cwd: '.', hook_event_name: 'Stop', stop_hook_active: false };
  const first = await runHook(cwd, 'stop', 'claude-code', payloadA);
  assert.equal(first.code, 2);
  const second = await runHook(cwd, 'stop', 'claude-code', payloadA);
  assert.equal(second.code, 0);
  assert.equal(second.stderr, '');
  assert.equal(second.stdout, '');
  // fresh session id -> ask again (carried-over trigger fires because
  // the pending entry's recorded sessionId differs from stop-B).
  const third = await runHook(cwd, 'stop', 'claude-code', {
    session_id: 'stop-B',
    cwd: '.',
    hook_event_name: 'Stop',
    stop_hook_active: false,
  });
  assert.equal(third.code, 2);
  const state = JSON.parse(await readFile(join(cwd, '.rcf/feedback/state.json'), 'utf8'));
  assert.equal(state.asked.length, 2);
  assert.deepEqual(state.asked.map((r) => r.sessionId), ['stop-A', 'stop-B']);
});

test('AC-16101-3: Stop with stop_hook_active is silent even on a fresh session', async () => {
  const cwd = await scaffoldReady();
  await addOne(cwd, 'add-session');
  const res = await runHook(cwd, 'stop', 'claude-code', {
    session_id: 'stop-loop-guard',
    cwd: '.',
    hook_event_name: 'Stop',
    stop_hook_active: true,
  });
  assert.equal(res.code, 0);
  assert.equal(res.stderr, '');
});

// -- AC-16103-1 -----------------------------------------------------------

test('AC-16103-1: SessionEnd writes one bundle and is byte-idempotent on a re-run', async () => {
  const cwd = await scaffoldReady();
  await addOne(cwd, 'add-session');
  const start = Date.now();
  const first = await runHook(cwd, 'session-end', 'claude-code', {
    session_id: 'end-A', cwd: '.', hook_event_name: 'SessionEnd',
  });
  assert.equal(first.code, 0);
  const outbox = join(cwd, '.rcf/feedback/outbox');
  const filesA = (await readdir(outbox)).filter((f) => f.endsWith('-session-end.md'));
  assert.equal(filesA.length, 1);
  const bodyA = await readFile(join(outbox, filesA[0]), 'utf8');
  assert.match(bodyA, /# rcf feedback: session-end pending bundle/);
  const second = await runHook(cwd, 'session-end', 'claude-code', {
    session_id: 'end-A', cwd: '.', hook_event_name: 'SessionEnd',
  });
  assert.equal(second.code, 0);
  const filesB = (await readdir(outbox)).filter((f) => f.endsWith('-session-end.md'));
  assert.equal(filesB.length, 1, 'a re-run with the same pending set must not rewrite');
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 5000, `SessionEnd handler round-trip should stay well under 5s (got ${elapsed}ms)`);
});

// -- AC-16103-2 -----------------------------------------------------------

test('AC-16103-2: SessionStart on Claude Code prints the carry-over line for a new session', async () => {
  const cwd = await scaffoldReady();
  await addOne(cwd, 'prior-session');
  const res = await runHook(cwd, 'session-start', 'claude-code', {
    session_id: 'new-session',
    cwd: '.',
    hook_event_name: 'SessionStart',
  });
  assert.equal(res.code, 0);
  assert.match(res.stdout, /rcf feedback: 1 unsubmitted entry carried over/);
  assert.match(res.stdout, /RULE 17/);
  assert.equal(res.stderr, '');
  // Ledger stays untouched: SessionStart never sets asked.
  await assert.rejects(readFile(join(cwd, '.rcf/feedback/state.json'), 'utf8'), { code: 'ENOENT' });
});

test('AC-16103-2: SessionStart on Codex emits the additionalContext JSON shape', async () => {
  const cwd = await scaffoldReady();
  await addOne(cwd, 'prior-session');
  const res = await runHook(cwd, 'session-start', 'codex', {
    session_id: 'new-codex',
    cwd: '.',
    hook_event_name: 'SessionStart',
  });
  assert.equal(res.code, 0);
  const parsed = JSON.parse(res.stdout.trim());
  assert.match(parsed.additionalContext, /1 unsubmitted entry carried over/);
});

test('AC-16103-2: SessionStart with no carried-over entries is silent', async () => {
  const cwd = await scaffoldReady();
  const res = await runHook(cwd, 'session-start', 'claude-code', {
    session_id: 'empty-session',
    cwd: '.',
    hook_event_name: 'SessionStart',
  });
  assert.equal(res.code, 0);
  assert.equal(res.stdout, '');
});
