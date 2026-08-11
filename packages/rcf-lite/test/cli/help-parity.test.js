// Guard for the single-source help rule.
//
// `src/cli/help.js` used to keep private duplicates of most subcommand
// help blocks. Nine of them had drifted stale and `rcf help create` was
// hiding the `cn` kind entirely - the discovery path an agent reaches
// for first was the wrong one. The duplicates are gone; this test is
// what stops them coming back.
//
// Two assertions, both driven off live data rather than a hand-written
// list, so a newly added verb is covered the moment it is registered:
//   1. `rcf help <cmd>` is byte-identical to `rcf <cmd> --help` for
//      every key in HELP_MAP.
//   2. every dispatchable subcommand in bin/rcf.js has a HELP_MAP entry.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { SUBCOMMANDS } from '../../bin/rcf.js';
import { HELP_MAP } from '../../src/cli/help.js';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, '..', '..', 'bin', 'rcf.js');

async function runBin(args) {
  try {
    const { stdout } = await exec(process.execPath, [bin, ...args], { encoding: 'utf8' });
    return stdout;
  } catch (err) {
    return err.stdout ?? '';
  }
}

const commands = Object.keys(HELP_MAP);

test('HELP_MAP is not empty (guards against a vacuous parity sweep)', () => {
  assert.ok(commands.length >= 16, `expected 16+ help topics, got ${commands.length}`);
});

for (const cmd of commands) {
  test(`rcf help ${cmd} is byte-identical to rcf ${cmd} --help`, async () => {
    const viaHelp = await runBin(['help', cmd]);
    const viaFlag = await runBin([cmd, '--help']);
    assert.ok(viaHelp.length > 0, `rcf help ${cmd} printed nothing`);
    assert.equal(
      viaHelp,
      viaFlag,
      `help drift on '${cmd}': 'rcf help ${cmd}' and 'rcf ${cmd} --help' must be the same string. `
        + 'Import the block from the subcommand module rather than copying it into help.js.',
    );
  });
}

test('every dispatchable subcommand has a help topic', () => {
  const dispatchable = Object.keys(SUBCOMMANDS).filter((c) => c !== 'help');
  const missing = dispatchable.filter((c) => !(c in HELP_MAP));
  assert.deepEqual(missing, [], `subcommands with no 'rcf help <cmd>' topic: ${missing.join(', ')}`);
});

// Doc-loss guards for the three blocks that were merged rather than
// straight-replaced. Each line below was present on exactly one side of
// the old duplication and would have been silently dropped by a naive
// import-and-delete.
test('merged blocks kept the text that only one side had', async () => {
  const create = await runBin(['help', 'create']);
  assert.match(create, /--parent/, 'create lost the full option list');
  assert.match(create, /\| cn\b/, 'create lost the cn kind');
  assert.match(create, /Code Node \(cn\) options:/, 'create lost the CN option block');

  const validate = await runBin(['help', 'validate']);
  assert.match(validate, /Walk the rcf\/ tree/, 'validate lost its descriptive paragraph');
  assert.match(validate, /--no-code/, 'validate lost --no-code');

  const del = await runBin(['help', 'delete']);
  assert.match(del, /dependents discovered via computed maps/, 'delete lost the computed-maps note');
});
