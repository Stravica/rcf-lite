// Tier-1 hardening drift tests (REQ-008). These assert the content
// invariants the deploy-aware, runtime-honest guidance must keep, so the
// shipped pack and the ACs that require it cannot silently diverge. Every
// assertion here is the on-disk evidence behind a US-801..805 AC and is
// pointed at by a Code Node. Node 24 built-ins only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { loadHarnessFragment } from '../../src/setup/agent-setup.js';

const guidanceDir = fileURLToPath(new URL('../../guidance', import.meta.url));

async function read(file) {
  return readFile(new URL(`../../guidance/${file}`, import.meta.url), 'utf8');
}

// --- US-801: every build leaves a working local preview ---

test('AC-801-1/3: the build cycle requires a local preview as the hosting-independent default outcome', async () => {
  const contract = await read('build-cycle.md');
  const playbook = await read('build-cycle-playbook.md');
  // Contract states it as part of done.
  assert.match(contract, /working, documented local preview/i);
  assert.match(contract, /definition of done/i);
  // Playbook: hosting-independent default, produced whether or not a host was named.
  assert.match(playbook, /default outcome of every build/i);
  assert.match(playbook, /whether or not (a host was named|the owner has stated)/i);
});

test('AC-801-2: the local preview is startable via a single documented command where the stack allows', async () => {
  const playbook = await read('build-cycle-playbook.md');
  assert.match(playbook, /one\s+(documented\s+)?command/i);
  assert.match(playbook, /where the stack allows|where a stack genuinely cannot/i);
});

test('AC-801-4: the preview carries seeded data when the app needs data to be usable', async () => {
  const playbook = await read('build-cycle-playbook.md');
  assert.match(playbook, /seeded or sample data/i);
  assert.match(playbook, /empty shell|empty screen/i);
});

// --- US-802: deploy target established before the stack is chosen ---

test('AC-802-1: elicitation places a deploy-target question early, before any stack is committed', async () => {
  const elicit = await read('elicitation-playbook.md');
  assert.match(elicit, /before any (technology )?stack is (named or )?committed/i);
  assert.match(elicit, /deploy target/i);
  // Surfaced in the method-in-one-view decomposition as an early step.
  assert.match(elicit, /before any stack\s+->\s+deploy target/i);
});

test('AC-802-2: the stack choice is constrained by the deploy-target answer', async () => {
  const elicit = await read('elicitation-playbook.md');
  assert.match(elicit, /constrain the stack to the answer/i);
  assert.match(elicit, /that target can (actually )?host/i);
});

test('AC-802-3: the deploy target and its stack implication are captured as an ADR on the project tree', async () => {
  const elicit = await read('elicitation-playbook.md');
  assert.match(elicit, /capture it as an ADR/i);
  assert.match(elicit, /visible and revisable/i);
});

test('AC-802-4: the harness fragment forbids committing a stack before the deploy target is established', async () => {
  const fragment = await loadHarnessFragment();
  assert.match(fragment, /RULE 5/);
  assert.match(fragment, /stack must NOT be committed before the deploy target/i);
});

// --- US-803: hosting-choice walkthrough when the owner is unsure ---

test('AC-803-1: when the owner does not know, run a walkthrough rather than choosing silently', async () => {
  const elicit = await read('elicitation-playbook.md');
  assert.match(elicit, /hosting-choice walkthrough/i);
  assert.match(elicit, /do not choose silently/i);
});

test('AC-803-2: the walkthrough explains options in plain language with no unexplained jargon', async () => {
  const elicit = await read('elicitation-playbook.md');
  assert.match(elicit, /plain language, no unexplained jargon/i);
});

test('AC-803-3: human-only steps are isolated and named honestly, not performed or pretended', async () => {
  const elicit = await read('elicitation-playbook.md');
  assert.match(elicit, /account-holder's to do/i);
  assert.match(elicit, /must not be pretended|never perform these silently/i);
  assert.match(elicit, /sign-ups|billing|tokens?|CLI auth/i);
});

test('AC-803-4: the walkthrough covers configuring the account, not only naming a provider', async () => {
  const elicit = await read('elicitation-playbook.md');
  assert.match(elicit, /configuring the account/i);
  assert.match(elicit, /not just naming a provider|Naming a provider and stopping/i);
});

// --- US-804: verification claims name their runtime ---

test('AC-804-1/2: every verification claim names its runtime and never implies an unexercised deployed runtime', async () => {
  const playbook = await read('build-cycle-playbook.md');
  assert.match(playbook, /names the runtime it was checked against/i);
  assert.match(playbook, /No claim may state or imply deploy-runtime verification that did not happen/i);
});

test('AC-804-3: the PR-authoring guidance requires the runtime label in the verification section', async () => {
  const playbook = await read('build-cycle-playbook.md');
  // The section-12 verification bullet carries the requirement.
  assert.match(playbook, /Every claim in this section names the runtime it was checked against/i);
});

test('AC-804-4: an explicit labelled example exists, with a non-Cloudflare example alongside the wrangler-dev one', async () => {
  const playbook = await read('build-cycle-playbook.md');
  assert.match(playbook, /wrangler dev \(localhost/i);
  assert.match(playbook, /NOT the deployed Worker runtime/i);
  // Deploy-anywhere: a second, non-Cloudflare worked example.
  assert.match(playbook, /Vercel/);
  assert.match(playbook, /NOT the deployed Vercel/i);
});

test('AC-804 wording is compatible with the runtime-profile model (deployed / ci / local-dev), no competing taxonomy', async () => {
  const playbook = await read('build-cycle-playbook.md');
  assert.match(playbook, /`deployed`/);
  assert.match(playbook, /`ci`/);
  assert.match(playbook, /`local-dev`/);
  assert.match(playbook, /ship verdict comes only from `deployed`|declared parity/i);
});

// --- US-805: interim self-review guidance ---

test('AC-805-1: a periodic and end-of-build fresh-context self-review dispatch is described', async () => {
  const playbook = await read('build-cycle-playbook.md');
  assert.match(playbook, /fresh-context/i);
  assert.match(playbook, /every few FBS builds/i);
  assert.match(playbook, /once more at the end of the build|at the end of the build/i);
  assert.match(playbook, /subagent dispatch|manual-review subagent/i);
});

test('AC-805-2: the reviewer drives the running app against the ACs rather than reading the code', async () => {
  const playbook = await read('build-cycle-playbook.md');
  assert.match(playbook, /drives it against the acceptance criteria/i);
  assert.match(playbook, /does not read the code|rather than reading the (diff|code)/i);
});

test('AC-805-3: the review names the target defect classes', async () => {
  const playbook = await read('build-cycle-playbook.md');
  assert.match(playbook, /session-class bugs/i);
  assert.match(playbook, /false-promise UI/i);
  assert.match(playbook, /runtime mismatch/i);
  assert.match(playbook, /dead auth paths/i);
  assert.match(playbook, /dead code/i);
});

test('AC-805-4: the self-review is honestly scoped as interim and not the independent gate', async () => {
  const playbook = await read('build-cycle-playbook.md');
  assert.match(playbook, /interim guidance until rcf-verify-lite/i);
  assert.match(playbook, /not a new subsystem/i);
  assert.match(playbook, /not the independent verification gate/i);
});

// Fragment carries the deploy-aware and runtime-honest RULE blocks.
test('the harness fragment carries the local-preview and runtime-provenance rules (RULE 6, RULE 7)', async () => {
  const fragment = await loadHarnessFragment();
  assert.match(fragment, /RULE 6 - Every build lands a local preview/);
  assert.match(fragment, /RULE 7 - Verification claims name their runtime/);
});
