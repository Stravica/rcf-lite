// Builder hygiene test (FBS-242, the stage-keeper's rulings on re-Review 3
// and on the position oracle): node is the oracle, and a position node
// gives that the audit cannot check is withheld with a stderr line. This
// runs the view of src/audit/test-strength/source.js over every case of
// the position corpus (test/fixtures/rc-46/position-corpus.json) and
// asserts each detail is placed at the case's recorded position and no
// case reaches the withheld path. It tests code hygiene only, is bound to
// no test case, and sits outside the RCF suite.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sourceView } from '../../src/audit/test-strength/source.js';

const corpus = JSON.parse(readFileSync(new URL('../fixtures/rc-46/position-corpus.json', import.meta.url), 'utf8'));

test('hygiene: every case of the position corpus is placed at its recorded position and none reaches the withheld path', () => {
  let cases = 0;
  for (const entry of corpus.entries) {
    for (const c of entry.cases) {
      cases += 1;
      const file = `src/a${c.kind}`;
      const v = sourceView(file, c.text);
      assert.equal(v.ok, false, `${entry.id} ${c.kind}: the view refuses the input`);
      assert.equal(v.warn, undefined, `${entry.id} ${c.kind}: the position node gave is checked\n${v.detail}\n${v.warn}`);
      const where = /(\S+):(\d+:\d+):/.exec(v.detail);
      assert.deepEqual(where && [where[1], where[2]], [file, c.at], `${entry.id} ${c.kind}: placed at ${c.at}\n${v.detail}`);
    }
  }
  assert.ok(cases > 0, 'the corpus holds cases');
});
