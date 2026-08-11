// Regression tests for the SERVICE_PATTERNS heuristic fix
// (verification-integrity-cluster-spec §5.3): verify's provision layer
// now delegates service detection to the shared core seed set
// (`#core/patterns/services`), so the d-2026-07-30-142
// "email channel" miss cannot recur.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyPrerequisite } from '../../../src/verify/provision/index.js';

test('classifyPrerequisite: catches "email channel via Resend" (the d-142 miss)', () => {
  const ac = {
    acId: 'AC-1001-2',
    description: 'Outbound recovery email is sent via the email channel',
    given: 'a recovery event is emitted',
    when: 'the email channel dispatches the message',
    then: 'the recipient receives the notification',
  };
  assert.equal(classifyPrerequisite(ac), 'serviceSandbox');
});

test('classifyPrerequisite: catches the historically-missed "email provider" phrasing', () => {
  const ac = { acId: 'AC-x', description: 'we call our email provider to send a note', given: '', when: '', then: '' };
  assert.equal(classifyPrerequisite(ac), 'serviceSandbox');
});

test('classifyPrerequisite: still catches the pre-0.7.0 payment / stripe / webhook phrases', () => {
  assert.equal(classifyPrerequisite({ acId: 'a', description: 'checkout via Stripe', given: '', when: '', then: '' }), 'serviceSandbox');
  assert.equal(classifyPrerequisite({ acId: 'a', description: 'inbound webhook from payment provider', given: '', when: '', then: '' }), 'serviceSandbox');
});

test('classifyPrerequisite: auth wording still classifies as authAccount, not serviceSandbox', () => {
  assert.equal(classifyPrerequisite({ acId: 'a', description: 'user can sign in with valid credentials', given: '', when: '', then: '' }), 'authAccount');
});

test('classifyPrerequisite: text with no service / auth / seed signal returns null', () => {
  assert.equal(classifyPrerequisite({ acId: 'a', description: 'landing page renders a headline', given: '', when: '', then: '' }), null);
});
