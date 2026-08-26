// Guard for the single-source help rule.
//
// `src/cli/help.js` used to keep private duplicates of most sub-verb
// help blocks. Nine of them had drifted stale and `rcf help create` was
// hiding the `cn` kind entirely - the discovery path an agent reaches
// for first was the wrong one. The duplicates are gone; this test is
// what stops them coming back.
//
// Post 0.10.0 the help catalogue is grouped. Two assertions, both
// driven off live data rather than a hand-written list, so a newly
// added verb is covered the moment it is registered:
//   1. `rcf help <group> <verb>` is byte-identical to
//      `rcf <group> <verb> --help` for every entry in HELP_MAP.
//   2. every dispatchable verb in bin/rcf.js has a HELP_MAP entry (per
//      group), and every core verb has a CORE_HELP entry.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { CORE, GROUPS } from '../../bin/rcf.js';
import { HELP_MAP, CORE_HELP, GROUP_HELP } from '../../src/cli/help.js';

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

test('HELP_MAP is not empty (guards against a vacuous parity sweep)', () => {
  const total = Object.values(HELP_MAP).reduce((n, group) => n + Object.keys(group).length, 0);
  assert.ok(total >= 20, `expected 20+ per-verb help topics across groups, got ${total}`);
});

for (const [group, verbs] of Object.entries(HELP_MAP)) {
  for (const verb of Object.keys(verbs)) {
    test(`rcf help ${group} ${verb} is byte-identical to rcf ${group} ${verb} --help`, async () => {
      const viaHelp = await runBin(['help', group, verb]);
      const viaFlag = await runBin([group, verb, '--help']);
      assert.ok(viaHelp.length > 0, `rcf help ${group} ${verb} printed nothing`);
      assert.equal(
        viaHelp,
        viaFlag,
        `help drift on '${group} ${verb}': 'rcf help ${group} ${verb}' and 'rcf ${group} ${verb} --help' must be the same string. `
          + 'Import the block from the verb module rather than copying it into help.js.',
      );
    });
  }
}

test('every dispatchable grouped verb has a HELP_MAP entry', () => {
  const missing = [];
  for (const [group, verbs] of Object.entries(GROUPS)) {
    for (const verb of Object.keys(verbs)) {
      if (!HELP_MAP[group] || !(verb in HELP_MAP[group])) {
        missing.push(`${group} ${verb}`);
      }
    }
  }
  assert.deepEqual(missing, [], `verbs with no help topic: ${missing.join(', ')}`);
});

test('every core verb has a CORE_HELP entry', () => {
  const missing = Object.keys(CORE).filter((c) => !(c in CORE_HELP));
  assert.deepEqual(missing, [], `core verbs with no help topic: ${missing.join(', ')}`);
});

test('every group has a GROUP_HELP entry', () => {
  const missing = Object.keys(GROUPS).filter((g) => !(g in GROUP_HELP));
  assert.deepEqual(missing, [], `groups with no group help: ${missing.join(', ')}`);
});

// Doc-loss guards for the three blocks that were merged rather than
// straight-replaced. Each line below was present on exactly one side of
// the old duplication and would have been silently dropped by a naive
// import-and-delete.
test('merged blocks kept the text that only one side had', async () => {
  const create = await runBin(['help', 'define', 'create']);
  assert.match(create, /--parent/, 'create lost the full option list');
  assert.match(create, /\| cn\b/, 'create lost the cn kind');
  assert.match(create, /Code Node \(cn\) options:/, 'create lost the CN option block');

  const validate = await runBin(['help', 'define', 'validate']);
  assert.match(validate, /Walk the rcf\/ tree/, 'validate lost its descriptive paragraph');
  assert.match(validate, /--no-code/, 'validate lost --no-code');

  const del = await runBin(['help', 'define', 'delete']);
  assert.match(del, /dependents discovered via computed maps/, 'delete lost the computed-maps note');
});
