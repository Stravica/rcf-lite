import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// @ws/lib resolves through the rcf project root's node_modules, where npm's
// hoisted layout links the workspace package by name. When
// RCF_ROUND_F_WITNESS is set (round F, F-9), each run first appends the
// real path of the file @ws/lib resolves to.
test('H1 greet comes from the hoisted workspace library', async () => {
  if (process.env.RCF_ROUND_F_WITNESS) appendFileSync(process.env.RCF_ROUND_F_WITNESS, `${realpathSync(fileURLToPath(import.meta.resolve('@ws/lib')))}\n`);
  const { greet } = await import('@ws/lib');
  assert.equal(greet('Ada'), 'hello Ada');
  assert.equal(greet(''), 'hello');
});
