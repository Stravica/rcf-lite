// Builder hygiene test (FBS-242, the stage-keeper's ruling 4 on the
// design review): a refusal the width-neutral shadow cannot reproduce has
// no criterion form, and no input reaches it. This runs the view of
// src/audit/test-strength/source.js over every case of the position
// corpus (test/fixtures/rc-46/position-corpus.json) and asserts each
// detail is placed at the case's recorded position and the unplaceable
// path is never reached. It tests code hygiene only, is bound to no test
// case, and sits outside the RCF suite.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sourceView } from '../../src/audit/test-strength/source.js';

const corpus = JSON.parse(readFileSync(new URL('../fixtures/rc-46/position-corpus.json', import.meta.url), 'utf8'));

test('hygiene: every case of the position corpus is placed at its recorded position and none reaches the unplaceable path', () => {
  let cases = 0;
  for (const entry of corpus.entries) {
    for (const c of entry.cases) {
      cases += 1;
      const file = `src/a${c.kind}`;
      const v = sourceView(file, c.text);
      assert.equal(v.ok, false, `${entry.id} ${c.kind}: the view refuses the input`);
      assert.notEqual(v.unplaced, true, `${entry.id} ${c.kind}: the refusal is placed\n${v.detail}`);
      const where = /(\S+):(\d+:\d+):/.exec(v.detail);
      assert.deepEqual(where && [where[1], where[2]], [file, c.at], `${entry.id} ${c.kind}: placed at ${c.at}\n${v.detail}`);
    }
  }
  assert.ok(cases > 0, 'the corpus holds cases');
});
