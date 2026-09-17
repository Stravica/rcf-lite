// FBS-184 slice 5 CLI tests for `rcf init` installing the feedback
// hooks into .claude/settings.json and .codex/hooks.json (design
// 3.5, ADR-4108). Binds AC-16104-1 (init merges three hook entries
// into each committed file, byte-idempotent on re-init, existing
// hooks preserved) and AC-16104-2 (--no-feedback-hooks writes
// neither file and prints the fallback line).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, '..', '..', 'bin', 'rcf.js');

async function fixture() {
  return mkdtemp(join(tmpdir(), 'rcf-init-hooks-'));
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

// -- AC-16104-1 -----------------------------------------------------------

test('AC-16104-1: rcf init writes three feedback hook entries into both harness files', async () => {
  const cwd = await fixture();
  const r = await runInit(cwd, ['--project-name', 'HookInit']);
  assert.equal(r.code, 0);
  const claude = JSON.parse(await readFile(join(cwd, '.claude/settings.json'), 'utf8'));
  const codex = JSON.parse(await readFile(join(cwd, '.codex/hooks.json'), 'utf8'));
  for (const event of ['Stop', 'SessionEnd', 'SessionStart']) {
    const bucket = claude.hooks[event];
    assert.ok(Array.isArray(bucket) && bucket.length >= 1, `.claude/settings.json missing ${event}`);
    const ours = bucket.find((e) => Array.isArray(e?.hooks)
      && e.hooks.some((h) => typeof h?.command === 'string' && h.command.includes('feedback hook')));
    assert.ok(ours, `Claude entry for ${event} not found`);
    const cmd = ours.hooks.find((h) => h.command.includes('feedback hook'));
    assert.match(cmd.command, /^npx rcf-lite feedback hook /);
    assert.match(cmd.command, /--harness claude-code$/);
    assert.equal(cmd.type, 'command');
  }
  assert.equal(claude.hooks.SessionStart[0].matcher, 'startup|resume');
  assert.equal(claude.hooks.Stop[0].hooks[0].timeout, 10);
  assert.equal(claude.hooks.SessionEnd[0].hooks[0].timeout, 5);
  assert.equal(claude.hooks.SessionStart[0].hooks[0].timeout, 5);

  for (const event of ['Stop', 'SessionEnd', 'SessionStart']) {
    const bucket = codex.hooks[event];
    assert.ok(Array.isArray(bucket) && bucket.length >= 1, `.codex/hooks.json missing ${event}`);
    const ours = bucket.find((e) => typeof e?.command === 'string' && e.command.includes('feedback hook'));
    assert.ok(ours, `Codex entry for ${event} not found`);
    assert.match(ours.command, /^npx rcf-lite feedback hook /);
    assert.match(ours.command, /--harness codex$/);
  }
});

test('AC-16104-1: re-init on the same tree is byte-idempotent', async () => {
  const cwd = await fixture();
  await runInit(cwd, ['--project-name', 'HookIdem']);
  const claudeA = await readFile(join(cwd, '.claude/settings.json'), 'utf8');
  const codexA = await readFile(join(cwd, '.codex/hooks.json'), 'utf8');
  await runInit(cwd, ['--project-name', 'HookIdem']);
  const claudeB = await readFile(join(cwd, '.claude/settings.json'), 'utf8');
  const codexB = await readFile(join(cwd, '.codex/hooks.json'), 'utf8');
  assert.equal(claudeB, claudeA, '.claude/settings.json changed on re-init');
  assert.equal(codexB, codexA, '.codex/hooks.json changed on re-init');
});

test('AC-16104-1: pre-existing hooks are preserved; feedback entries added alongside', async () => {
  const cwd = await fixture();
  const claudePath = join(cwd, '.claude/settings.json');
  await mkdir(dirname(claudePath), { recursive: true });
  const existing = {
    hooks: {
      Stop: [
        { hooks: [{ type: 'command', command: 'echo unrelated', timeout: 3 }] },
      ],
    },
    someUnrelatedKey: 42,
  };
  await writeFile(claudePath, JSON.stringify(existing, null, 2), 'utf8');
  const r = await runInit(cwd, ['--project-name', 'HookMerge']);
  assert.equal(r.code, 0);
  const after = JSON.parse(await readFile(claudePath, 'utf8'));
  assert.equal(after.someUnrelatedKey, 42, 'unrelated top-level key preserved');
  const stopBucket = after.hooks.Stop;
  assert.equal(stopBucket.length, 2, 'existing Stop entry preserved AND ours added');
  const preserved = stopBucket.find((e) => e.hooks?.[0]?.command === 'echo unrelated');
  assert.ok(preserved, 'echo unrelated must survive');
  const ours = stopBucket.find((e) => e.hooks?.[0]?.command?.includes('feedback hook'));
  assert.ok(ours, 'our Stop entry must be added alongside');
});

test('AC-16104-1: --bin-path pins the hook command to node <path>', async () => {
  const cwd = await fixture();
  const pinned = '/opt/pinned-rcf/rcf.js';
  const r = await runInit(cwd, ['--project-name', 'HookPin', '--bin-path', pinned]);
  assert.equal(r.code, 0);
  const claude = JSON.parse(await readFile(join(cwd, '.claude/settings.json'), 'utf8'));
  const cmd = claude.hooks.Stop[0].hooks[0].command;
  assert.match(cmd, /^node \/opt\/pinned-rcf\/rcf\.js feedback hook stop --harness claude-code$/);
});

// -- AC-16104-2 -----------------------------------------------------------

test('AC-16104-2: --no-feedback-hooks writes neither file and prints the fallback line', async () => {
  const cwd = await fixture();
  const r = await runInit(cwd, ['--project-name', 'HookSkip', '--no-feedback-hooks']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /no-feedback-hooks/);
  assert.match(r.stdout, /RULE 17/);
  await assert.rejects(readFile(join(cwd, '.claude/settings.json'), 'utf8'), { code: 'ENOENT' });
  await assert.rejects(readFile(join(cwd, '.codex/hooks.json'), 'utf8'), { code: 'ENOENT' });
});
