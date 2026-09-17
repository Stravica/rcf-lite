// FBS-184 slice 5 CLI tests for `rcf doctor --check feedback-hooks`
// (design 3.5, ADR-4108). Binds AC-16104-3: missing-hook is fixable
// with --fix, foreign-hook is refused, a clean tree exits 0 and
// makes no writes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { initProject } from '#core/store/init.js';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, '..', '..', 'bin', 'rcf.js');

async function scaffoldNoHooks() {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-doc-hook-'));
  await initProject({ projectRoot: tmp, projectName: 'DoctorHook' });
  return tmp;
}

async function runDoctor(cwd, args = []) {
  const env = { ...process.env, CI: '1' };
  try {
    const { stdout, stderr } = await exec(process.execPath, [bin, 'doctor', ...args], {
      cwd, encoding: 'utf8', env,
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

async function runInit(cwd, args = []) {
  const env = { ...process.env, CI: '1' };
  try {
    const { stdout, stderr } = await exec(process.execPath, [bin, 'init', ...args, '--non-interactive'], {
      cwd, encoding: 'utf8', env,
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

// -- AC-16104-3 -----------------------------------------------------------

test('AC-16104-3: doctor reports missing-hook per file per event when both configs are absent', async () => {
  const cwd = await scaffoldNoHooks();
  const r = await runDoctor(cwd, ['--check', 'feedback-hooks', '--json']);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.ok, false);
  const claudeMissing = parsed.drift.filter((d) => d.check === 'feedback-hooks' && d.file === '.claude/settings.json' && d.item === 'missing-hook');
  const codexMissing = parsed.drift.filter((d) => d.check === 'feedback-hooks' && d.file === '.codex/hooks.json' && d.item === 'missing-hook');
  assert.equal(claudeMissing.length, 3, 'three missing-hook rows for .claude/settings.json');
  assert.equal(codexMissing.length, 3, 'three missing-hook rows for .codex/hooks.json');
  assert.equal(r.code, 3);
});

test('AC-16104-3: doctor --fix installs the missing entries and re-runs clean', async () => {
  const cwd = await scaffoldNoHooks();
  const fix = await runDoctor(cwd, ['--check', 'feedback-hooks', '--fix']);
  assert.equal(fix.code, 0);
  const claude = JSON.parse(await readFile(join(cwd, '.claude/settings.json'), 'utf8'));
  const codex = JSON.parse(await readFile(join(cwd, '.codex/hooks.json'), 'utf8'));
  assert.equal(claude.hooks.Stop.length, 1);
  assert.equal(codex.hooks.Stop.length, 1);
  // Re-run is clean.
  const rerun = await runDoctor(cwd, ['--check', 'feedback-hooks']);
  assert.equal(rerun.code, 0);
  assert.match(rerun.stdout, /rcf doctor: clean\./);
});

test('AC-16104-3: doctor refuses a foreign-hook entry and leaves it in place', async () => {
  const cwd = await scaffoldNoHooks();
  await runInit(cwd, ['--project-name', 'DocForeign']);
  // Now perturb the Stop entry so the command is foreign (wrong flag).
  const claudePath = join(cwd, '.claude/settings.json');
  const claude = JSON.parse(await readFile(claudePath, 'utf8'));
  claude.hooks.Stop[0].hooks[0].command = 'npx rcf-lite feedback hook stop --harness claude-code --dangerously-yes';
  await writeFile(claudePath, JSON.stringify(claude, null, 2), 'utf8');
  const r = await runDoctor(cwd, ['--check', 'feedback-hooks', '--fix', '--json']);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.ok, false);
  const foreign = parsed.drift.filter((d) => d.item === 'foreign-hook' && d.file === '.claude/settings.json');
  assert.equal(foreign.length, 1);
  assert.match(foreign[0].message, /foreign command shape/);
  // The foreign command survived; --fix did not overwrite it.
  const after = JSON.parse(await readFile(claudePath, 'utf8'));
  assert.match(after.hooks.Stop[0].hooks[0].command, /--dangerously-yes/);
  assert.equal(r.code, 3);
});

test('AC-16104-3: a clean tree makes no writes and stays exit 0', async () => {
  const cwd = await scaffoldNoHooks();
  await runInit(cwd, ['--project-name', 'DocClean']);
  const claudeBefore = await readFile(join(cwd, '.claude/settings.json'), 'utf8');
  const codexBefore = await readFile(join(cwd, '.codex/hooks.json'), 'utf8');
  const r = await runDoctor(cwd, ['--check', 'feedback-hooks', '--fix']);
  assert.equal(r.code, 0);
  const claudeAfter = await readFile(join(cwd, '.claude/settings.json'), 'utf8');
  const codexAfter = await readFile(join(cwd, '.codex/hooks.json'), 'utf8');
  assert.equal(claudeAfter, claudeBefore, 'no unnecessary rewrite on a clean tree');
  assert.equal(codexAfter, codexBefore);
});

test('AC-16104-3: doctor rejects an unparseable settings file with parse-error and refuses --fix', async () => {
  const cwd = await scaffoldNoHooks();
  const claudePath = join(cwd, '.claude/settings.json');
  await mkdir(dirname(claudePath), { recursive: true });
  await writeFile(claudePath, 'this is not JSON', 'utf8');
  const r = await runDoctor(cwd, ['--check', 'feedback-hooks', '--fix', '--json']);
  const parsed = JSON.parse(r.stdout);
  const parseErr = parsed.drift.filter((d) => d.item === 'parse-error' && d.file === '.claude/settings.json');
  assert.equal(parseErr.length, 1);
  assert.equal(r.code, 3);
  // File left untouched.
  const after = await readFile(claudePath, 'utf8');
  assert.equal(after, 'this is not JSON');
});
