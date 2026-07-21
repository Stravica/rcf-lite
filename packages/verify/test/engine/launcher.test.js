// Launcher tests (spec §7.3, §9, §11): the isolation env is applied to the
// launch config, and the launcher-resolution precedence (injected > env module
// > default spawn) holds.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildLaunchConfig, resolveLauncher, LAUNCHER_ENV } from '../../src/engine/launcher.js';

test('buildLaunchConfig: stamps the §7.3 isolation env (both flags) onto the child env', () => {
  const cfg = buildLaunchConfig({ brief: { stance: 'disprove' }, url: 'https://app' }, { baseEnv: { PATH: '/usr/bin' } });
  assert.equal(cfg.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, '1');
  assert.equal(cfg.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, '1');
  assert.equal(cfg.env.PATH, '/usr/bin'); // base preserved
  assert.deepEqual(cfg.isolation, { autoMemory: false, nonEssentialTraffic: false });
});

test('buildLaunchConfig: recipe wins over a leaked parent value (isolation cannot be re-enabled)', () => {
  const cfg = buildLaunchConfig({ brief: {}, url: 'https://app' }, { baseEnv: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0' } });
  assert.equal(cfg.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, '1');
});

test('buildLaunchConfig: command defaults to claude, overridable for other harnesses', () => {
  assert.equal(buildLaunchConfig({ brief: {}, url: 'x' }).command, 'claude');
  assert.equal(buildLaunchConfig({ brief: {}, url: 'x' }, { command: 'my-agent' }).command, 'my-agent');
});

test('resolveLauncher: an injected launchAgent takes precedence', async () => {
  const injected = async () => ({ findings: [] });
  const fn = await resolveLauncher({ launchAgent: injected });
  assert.equal(fn, injected);
});

test('resolveLauncher: RCF_VERIFY_LAUNCHER module is used when no injection', async () => {
  const prev = process.env[LAUNCHER_ENV];
  try {
    // A data: URL module exporting launchAgent — no temp file needed.
    process.env[LAUNCHER_ENV] = 'data:text/javascript,export async function launchAgent(){return {findings:[]}}';
    const fn = await resolveLauncher({});
    const out = await fn({ brief: {}, url: 'x' });
    assert.deepEqual(out, { findings: [] });
  } finally {
    if (prev === undefined) delete process.env[LAUNCHER_ENV]; else process.env[LAUNCHER_ENV] = prev;
  }
});
