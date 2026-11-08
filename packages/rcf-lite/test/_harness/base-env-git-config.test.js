// The harness environment's git contract (test/_harness/spawn.js
// baseEnv). The harness shuts out global and system git config, so git's
// built-in defaults apply to every git child, and those change between
// git versions. One of them, automatic maintenance, can start a
// background repack after a commit in a fixture repository while a test
// copies that repository's .git/objects. baseEnv switches it off for
// every git child through git's command-line config variables
// (GIT_CONFIG_COUNT, GIT_CONFIG_KEY_<n>, GIT_CONFIG_VALUE_<n>), appended
// after any such entries the caller's environment already carries. The
// test builds the inherited environment itself and restores it after, so
// the result never depends on how the host running the suite is set up.
// Imports Node builtins and the harness only.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { baseEnv } from './spawn.js';
import { gitTry } from './git.js';
import { scratch } from './fixture.js';

const CONFIG_VAR = /^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$/;

// Run fn with process.env's git command-line config replaced by vars.
function withInherited(vars, fn) {
  const saved = Object.entries(process.env).filter(([k]) => CONFIG_VAR.test(k));
  for (const [k] of saved) delete process.env[k];
  Object.assign(process.env, vars);
  try {
    return fn();
  } finally {
    for (const k of Object.keys(process.env)) if (CONFIG_VAR.test(k)) delete process.env[k];
    for (const [k, v] of saved) process.env[k] = v;
  }
}

const configOf = (env) => Object.fromEntries(Object.entries(env).filter(([k]) => CONFIG_VAR.test(k)));

test('harness env: baseEnv switches git automatic maintenance off for every git child, after any git command-line config the environment already carries', (t) => {
  // Nothing inherited: one entry, at index 0.
  const none = withInherited({}, () => baseEnv());
  assert.deepEqual(configOf(none), { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'maintenance.auto', GIT_CONFIG_VALUE_0: 'false' }, 'with no git command-line config inherited, baseEnv sets maintenance.auto=false as the one entry');

  // One entry inherited: kept at index 0, maintenance.auto=false at index 1.
  const inherited = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'fixture.kept', GIT_CONFIG_VALUE_0: 'yes' };
  const one = withInherited(inherited, () => baseEnv());
  assert.deepEqual(configOf(one), { ...inherited, GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_1: 'maintenance.auto', GIT_CONFIG_VALUE_1: 'false' }, 'an inherited entry is kept at index 0 and maintenance.auto=false is added at index 1, count 2');

  // The same entry passed by the caller as extra env, not inherited.
  const extra = withInherited({}, () => baseEnv(inherited));
  assert.deepEqual(configOf(extra), configOf(one), 'an entry the caller passes in extra is kept the same way');

  // A git child the harness starts reads both values.
  const dir = scratch(t, 'rcf-h-gitcfg-');
  withInherited(inherited, () => {
    const auto = gitTry(dir, 'config', '--get', 'maintenance.auto');
    assert.deepEqual({ code: auto.code, value: auto.stdout.trim() }, { code: 0, value: 'false' }, `a harness git child reads maintenance.auto as false (git config --get exited ${auto.code}${auto.stderr ? `: ${auto.stderr.trim()}` : ''})`);
    const kept = gitTry(dir, 'config', '--get', 'fixture.kept');
    assert.deepEqual({ code: kept.code, value: kept.stdout.trim() }, { code: 0, value: 'yes' }, 'a harness git child still reads the inherited entry');
  });
});
