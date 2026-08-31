// Theme 1 fragment sanity: the harness-template fragment is the single
// source `rcf init` writes into agent-instructions files. It must stay
// extractable (first ```markdown fence) and must keep the three firm
// rules that foreclose the observed E2E failure modes: single-shot
// fabrication, silently dropped layers, and a skipped test layer.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadHarnessFragment, MARKER_BEGIN, MARKER_END } from '../../src/setup/agent-setup.js';

test('the fragment extracts from guidance/harness-template.md', async () => {
  const fragment = await loadHarnessFragment();
  assert.equal(typeof fragment, 'string', fragment?.message);
  assert.equal(fragment.length > 500, true, 'fragment is substantive');
  assert.equal(fragment.includes('```'), false, 'no nested fences');
});

test('the fragment carries the three firm rule areas', async () => {
  const fragment = await loadHarnessFragment();
  // Rule 1: elicitation first, no single-shot fabrication.
  assert.match(fragment, /RULE 1: Elicit first/);
  assert.match(fragment, /rcf_elicit_requirements/);
  assert.match(fragment, /do not invent it\./);
  // Rule 2: the full chain including the tech layer; TODOs are not done.
  assert.match(fragment, /RULE 2: The full chain/);
  assert.match(fragment, /PRD, REQ, US, AC, TS, TC/);
  assert.match(fragment, /TAD, TAC, ADR/);
  assert.match(fragment, /TODO placeholders are not\s+a\s+finished state/);
  // Rule 3: mandatory test layer gated on coverage.
  assert.match(fragment, /RULE 3: The test layer/);
  assert.match(fragment, /coverage --strict/);
});

test('the fragment presents as rules, not suggestions', async () => {
  const fragment = await loadHarnessFragment();
  assert.match(fragment, /hard rules, not suggestions/);
});

test('the markers are stable strings init and the funnel agree on', () => {
  assert.equal(MARKER_BEGIN, '<!-- rcf:managed:begin -->');
  assert.equal(MARKER_END, '<!-- rcf:managed:end -->');
});

test('RULE 14 teaches the agent to run the freshness verb and OFFER, never install', async () => {
  const fragment = await loadHarnessFragment();
  // Header shape matches the rest of the ratchet.
  assert.match(fragment, /### RULE 14: Check freshness at session start; offer, never install\./);
  // The verb the rule tells the agent to run is the phase-2 CLI form.
  assert.match(fragment, /run `rcf version --check`/);
  // The load-bearing safety verb (Baz ruling): OFFER, in caps, and
  // "install" appears only inside "never install".
  assert.match(fragment, /OFFER the upgrade/);
  const installMatches = fragment.match(/\binstall\b/g) ?? [];
  const neverInstallMatches = fragment.match(/\bnever install\b/g) ?? [];
  assert.equal(
    installMatches.length,
    neverInstallMatches.length,
    'the bare word "install" appears only inside "never install"',
  );
  // Unknown-status silence: freshness is advisory, never a gate.
  assert.match(fragment, /status: "unknown"/);
  assert.match(fragment, /say nothing to the operator/);
  // Consent posture: never run the upgrade without explicit go.
  assert.match(fragment, /Never run the upgrade without the operator's\s+explicit go/);
});
