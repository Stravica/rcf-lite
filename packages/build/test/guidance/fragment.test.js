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
  assert.match(fragment, /RULE 1 - Elicit first/);
  assert.match(fragment, /rcf_elicit_requirements/);
  assert.match(fragment, /do not invent it - ask/);
  // Rule 2: the full chain including the tech layer; TODOs are not done.
  assert.match(fragment, /RULE 2 - The full chain/);
  assert.match(fragment, /PRD -> REQ -> US -> AC -> TS -> TC/);
  assert.match(fragment, /TAD, TAC, ADR/);
  assert.match(fragment, /TODO placeholders are NOT a finished state/);
  // Rule 3: mandatory test layer gated on coverage.
  assert.match(fragment, /RULE 3 - The test layer/);
  assert.match(fragment, /coverage --strict/);
});

test('the fragment presents as rules, not suggestions', async () => {
  const fragment = await loadHarnessFragment();
  assert.match(fragment, /hard\s+rules, not suggestions/);
});

test('the markers are stable strings init and the funnel agree on', () => {
  assert.equal(MARKER_BEGIN, '<!-- rcf:begin -->');
  assert.equal(MARKER_END, '<!-- rcf:end -->');
});
