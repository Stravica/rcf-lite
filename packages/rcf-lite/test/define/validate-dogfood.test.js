// 0.30.0 PR 8 (US-17802; REQ-178 / TAC-4126 / AC-17802-3).
//
// The rcf-lite dogfood tree is clean under the PR 8 define-validate
// findings (interface kind outside INTERFACE_KINDS, bracketed AC
// class prefix outside the known classes, tacIds naming a non-TAC,
// unresolving ownerRef or deliveredBy). Legacy interface kinds that
// pre-date spec section 5.2's closed vocabulary were mechanically
// remapped under PR 8; this test pins that no fresh finding has
// crept in on the dogfood tree.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { walkTree } from '../../src/core/store/walker.js';
import { collectDefineValidateFindings } from '../../src/define/validate-findings.js';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..', '..');

test('validate (PR 8, AC-17802-3): dogfood tree is clean', async () => {
  const { tree, errors: walkerErrors } = await walkTree({ projectRoot });
  // The dogfood walker tree is not expected to carry walker errors;
  // if it does, that is a different defect (not this test's concern).
  // We only inspect the PR 8 findings here.
  const findings = collectDefineValidateFindings(tree);
  assert.deepEqual(
    findings,
    [],
    `AC-17802-3: expected no PR 8 define-validate findings on the dogfood tree, found ${findings.length}: `
    + `${findings.slice(0, 3).map((f) => `${f.rule} ${f.documentId}`).join('; ')}`,
  );
  // Walker errors on the dogfood tree is a separate class; surfacing
  // it here (as an informational note) helps callers triage.
  if (walkerErrors.length > 0) {
    // The suite still passes; this test's AC is only about PR 8 findings.
    // eslint-disable-next-line no-console
    console.log(`[note] AC-17802-3 passed; walker reports ${walkerErrors.length} unrelated errors on the dogfood tree.`);
  }
});
