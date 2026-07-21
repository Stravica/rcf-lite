// Isolation-env recipe (spec §7.3). The recipe is a shared-suite invariant;
// these tests pin the two proven env vars and the recipe-wins-on-conflict
// contract that keeps a leaked parent value from re-enabling memory/traffic
// in the fresh verifier session.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ISOLATION_RECIPE, isolationEnv, isolationProvenance } from '../../src/isolation/index.js';

test('ISOLATION_RECIPE carries both proven flags (§7.3 run-05 clean sweep)', () => {
  assert.equal(ISOLATION_RECIPE.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, '1');
  assert.equal(ISOLATION_RECIPE.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, '1');
  assert.equal(ISOLATION_RECIPE.autoMemory, false);
});

test('ISOLATION_RECIPE is frozen — the shared recipe cannot be mutated in place', () => {
  assert.throws(() => { ISOLATION_RECIPE.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '0'; }, TypeError);
  assert.throws(() => { ISOLATION_RECIPE.autoMemory = true; }, TypeError);
});

test('isolationEnv layers the recipe over a base env, recipe wins on conflict', () => {
  const base = { PATH: '/usr/bin', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0', FOO: 'bar' };
  const env = isolationEnv(base);
  assert.equal(env.PATH, '/usr/bin');       // base value preserved
  assert.equal(env.FOO, 'bar');             // base value preserved
  assert.equal(env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, '1');       // recipe wins
  assert.equal(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, '1');
  // base object not mutated
  assert.equal(base.CLAUDE_CODE_DISABLE_AUTO_MEMORY, '0');
});

test('isolationProvenance reports both guarantees as applied', () => {
  assert.deepEqual(isolationProvenance(), { autoMemory: false, nonEssentialTraffic: false });
});
