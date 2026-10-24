// FBS-231 (US-16102, AC-16102-3): a headless agent session rcf-lite spawns
// runs with the feedback ask disabled, so a project's feedback Stop hook
// cannot turn a queued entry into the session's final output.
//
// The test drives `node bin/rcf.js verify run` in its default agent mode as a
// child process. The fixture project carries the rcf feedback hooks in
// .claude/settings.json (written by the installer in the pinned-bin form) and
// one pending entry recorded with --ask-now through `rcf feedback add`. The
// agent CLI the run spawns is a stand-in `claude` (absolute shebang, first on
// the child's PATH) that does what the harness does at the end of a turn: it
// runs the project's Stop hook command with the env it was given and a stop
// payload (fresh session id, stop_hook_active false). When the hook asks, the
// ask becomes the session's result (the model answers the feedback question);
// when the hook is silent, the result is the findings object. The stand-in
// records the env it received and the hook's exit code and stderr. The target
// is a local HTTP server on 127.0.0.1. No real agent CLI, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { chmod, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { initProject } from '#core/store/init.js';
import { writeClaudeFeedbackHooks } from '../../src/setup/feedback-hooks.js';
import { declareUiNoneForTests } from '../_helpers/d0.js';
import { scratchDir } from '../_helpers/scratch.js';

const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, '..', '..', 'bin', 'rcf.js');

// The stand-in agent CLI. It never calls a model and never touches the network.
function standInSource(recordPath) {
  return `#!${process.execPath}
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
let brief = '';
try { brief = readFileSync(0, 'utf8'); } catch {}
const settings = JSON.parse(readFileSync(join(process.cwd(), '.claude', 'settings.json'), 'utf8'));
const stop = (settings.hooks?.Stop ?? []).flatMap((g) => g.hooks ?? []).map((h) => h.command);
const payload = { session_id: randomUUID(), transcript_path: '', cwd: process.cwd(), hook_event_name: 'Stop', stop_hook_active: false };
const hookRuns = stop.map((command) => {
  const r = spawnSync(command, { shell: true, input: JSON.stringify(payload), env: process.env, encoding: 'utf8', timeout: 30000 });
  return { command, status: r.status, stderr: r.stderr ?? '' };
});
const ask = hookRuns.find((r) => r.status === 2);
writeFileSync(${JSON.stringify(recordPath)}, JSON.stringify({
  env: { RCF_FEEDBACK_ASK: process.env.RCF_FEEDBACK_ASK ?? null, RCF_FEEDBACK_DISABLE: process.env.RCF_FEEDBACK_DISABLE ?? null },
  argv: process.argv.slice(2), briefBytes: brief.length, hookRuns,
}));
const result = ask ? ask.stderr : JSON.stringify({ findings: [] });
process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result, num_turns: 1 }));
`;
}

function rcf(cwd, args, env) {
  return new Promise((res) => {
    execFile(process.execPath, [bin, ...args], { cwd, env, encoding: 'utf8', timeout: 120_000 }, (err, stdout, stderr) => {
      res({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: stdout ?? '', stderr: stderr ?? '' });
    });
  });
}

async function startServer(t) {
  const hits = [];
  const server = createServer((req, res) => {
    hits.push(new URL(req.url, 'http://x').pathname);
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>ok</title><p>ok</p>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  return { hits, url: `http://127.0.0.1:${server.address().port}` };
}

async function world(t) {
  const server = await startServer(t);
  const base = await scratchDir('rcf-fbs231-ask-');
  const root = join(base, 'project');
  const standInDir = join(base, 'bin');
  const childTmp = join(base, 'tmp');
  await mkdir(root, { recursive: true });
  await mkdir(standInDir, { recursive: true });
  await mkdir(childTmp, { recursive: true });
  await initProject({ projectRoot: root, projectName: 'HeadlessFeedbackAsk' });
  await declareUiNoneForTests(root);
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'server.js'), 'export const port = Number(process.env.PORT ?? 8787);\n', 'utf8');
  await writeFile(join(root, '.gitignore'), '.rcf/feedback/\n', 'utf8');
  await writeClaudeFeedbackHooks({ projectRoot: root, binPath: bin });
  const recordPath = join(base, 'stand-in-record.json');
  const standIn = join(standInDir, 'claude');
  await writeFile(standIn, standInSource(recordPath), 'utf8');
  await chmod(standIn, 0o755);
  // The child's env: the stand-in first on PATH, node beside it for the hook
  // command, TMPDIR inside the scratch dir. Nothing here silences the ask.
  const env = { ...process.env, CI: '1', TMPDIR: childTmp, PATH: [standInDir, dirname(process.execPath), '/usr/bin', '/bin'].join(':') };
  delete env.RCF_FEEDBACK_ASK;
  delete env.RCF_FEEDBACK_DISABLE;
  delete env.CLAUDECODE;
  delete env.RCF_VERIFY_LAUNCHER;
  return { root, base, server, recordPath, env };
}

test("AC-16102-3: rcf verify run in its default agent mode spawns the agent session with RCF_FEEDBACK_ASK=0, so the project's feedback Stop hook exits 0 silently inside it, a pending --ask-now entry stays pending, and the report carries the agent's findings instead of LAUNCH-FAILURE", async (t) => {
  const w = await world(t);
  const add = await rcf(w.root, ['feedback', 'add', '--kind', 'core', '--target', 'rcf verify run', '--anchor', 'AC-101-1',
    '--class', 'verb-error', '--severity', 'minor', '--title', 'queued before the verify run', '--body', 'fixture entry',
    '--evidence', 'rcf verify run', '--harness', 'claude-code', '--ask-now'], w.env);
  assert.equal(add.code, 0, `fixture: rcf feedback add records the entry\nstderr:\n${add.stderr}`);
  const before = JSON.parse((await rcf(w.root, ['feedback', 'list', '--json'], w.env)).stdout);
  const entries = Array.isArray(before) ? before : (before.entries ?? []);
  assert.equal(entries.length, 1, 'fixture: one pending entry before the run');
  const entryId = entries[0].id;

  const out = join(w.base, 'report.json');
  const r = await rcf(w.root, ['verify', 'run', '--repo', w.root, '--profile', 'local-dev', '--provision-mode', 'skip',
    '--url', w.server.url, '--out', out, '--fbs', 'FBS-001'], w.env);

  const record = JSON.parse(await readFile(w.recordPath, 'utf8'));
  assert.ok(record.hookRuns.length >= 1 && record.hookRuns.every((h) => h.command.includes('feedback hook stop')),
    `fixture: the stand-in agent ran the project's Stop hook (${JSON.stringify(record.hookRuns.map((h) => h.command))})`);
  const report = JSON.parse(await readFile(out, 'utf8'));
  assert.notEqual(report.verdict, 'LAUNCH-FAILURE',
    `the queued entry does not become the session's final output (exit ${r.code}; launchFailure: ${JSON.stringify(report.launchFailure ?? null)})`);
  assert.equal(report.launchFailure ?? null, null, 'the report carries no launchFailure');
  assert.ok(Array.isArray(report.findings), 'the report carries the agent\'s findings array');

  assert.equal(record.env.RCF_FEEDBACK_ASK, '0', 'the spawned agent session receives RCF_FEEDBACK_ASK=0');
  assert.equal(record.env.RCF_FEEDBACK_DISABLE, null, 'rcf-lite does not set RCF_FEEDBACK_DISABLE (rcf feedback add keeps working in the session)');
  for (const h of record.hookRuns) {
    assert.equal(h.status, 0, `the Stop hook inside the session exits 0 (got ${h.status}; stderr: ${h.stderr.slice(0, 200)})`);
    assert.equal(h.stderr, '', 'the Stop hook inside the session writes nothing to stderr (no ask)');
  }

  const after = JSON.parse((await rcf(w.root, ['feedback', 'list', '--json'], w.env)).stdout);
  const afterEntries = Array.isArray(after) ? after : (after.entries ?? []);
  assert.deepEqual(afterEntries.map((e) => [e.id, e.status]), [[entryId, 'pending']], 'the queued entry stays pending after the run');
  assert.deepEqual(await readdir(join(w.base, 'tmp')), [], 'no raw-transcript file left behind (no ingestion failure)');
});
