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
  assert.match(fragment, /stack must not be committed before the deploy target/i);
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

// --- Deferral: the owner who has not committed to building
// (w-2026-07-28-016). US-802/803 covered the owner who has a target and
// the owner who wants help picking one. Neither covered the owner who is
// exploring, deferring or not deploying, so the only escape hatch was a
// walkthrough that stands up accounts, tokens and billing. These assert
// the branch that closes that gap, and that RULE 5 stays an ordering
// rule rather than a demand that a target exist. No RCF tree ships in
// this repo, so these carry the invariant directly rather than an AC id.

test('deferral: RULE 5 orders target-before-stack without requiring the owner to have a target', async () => {
  const fragment = await loadHarnessFragment();
  assert.match(fragment, /stack must not be committed before the deploy target/i);
  assert.match(fragment, /ordering rule/i);
  assert.match(fragment, /does not require the owner to have a target/i);
  // The regression: a sentence reasserting unconditional earliness.
  assert.equal(
    /Where the app will run is elicited early/i.test(fragment), false,
    'RULE 5 reasserts unconditional earliness',
  );
});

test('deferral: RULE 5 names the defer / exploring / not-deploying answer as valid', async () => {
  const fragment = await loadHarnessFragment();
  assert.match(fragment, /defers, is still exploring, or is not deploying/i);
  assert.match(fragment, /an\s+answer, not a blocker/i);
  assert.match(fragment, /do not stand an\s+account up/i);
  // 0.6.0 canonical text carries the "deferred capability's acceptance
  // criteria are deferred with it" phrasing rather than the pre-0.6.0
  // "never do is turn into a silent stub". Both encode the same rule.
  assert.match(fragment, /acceptance criteria are deferred with it/i);
});

test('deferral: the playbook carries a branch distinct from the hosting-choice walkthrough', async () => {
  const elicit = await read('elicitation-playbook.md');
  assert.match(elicit, /### When the owner defers, is exploring, or is not deploying/);
  assert.match(elicit, /Do not run the hosting-choice walkthrough at someone who has not asked to choose/i);
  // The walkthrough branch is gated on the owner wanting to settle it.
  assert.match(elicit, /wants to settle it/i);
});

test('deferral: the branch is capability-class aware, not a blanket defer', async () => {
  const elicit = await read('elicitation-playbook.md');
  // Account-bound: nothing is applied.
  assert.match(elicit, /cannot exist without an account/i);
  assert.match(elicit, /deferral means \*\*nothing is applied\*\*/i);
  assert.match(elicit, /no provisional version of a hosting account/i);
  // Local-first: the live decision defers, the capability does not.
  assert.match(elicit, /a real local form/i);
  assert.match(elicit, /the live decision, not the capability/i);
  assert.match(elicit, /Blanket-deferring such a capability is the worse outcome/i);
});

test('deferral: it is recorded as an ADR and never becomes a silent stub', async () => {
  const elicit = await read('elicitation-playbook.md');
  assert.match(elicit, /Record the deferral as the ADR/i);
  assert.match(elicit, /deferred - no target chosen/i);
  assert.match(elicit, /Never let a deferral become a silent stub/i);
  assert.match(elicit, /acceptance criteria that require it are deferred with it/i);
  assert.match(elicit, /a stub the owner explicitly agreed to/i);
});

test('deferral: the deploy-target examples are ordered alphabetically, not editorially', async () => {
  const elicit = await read('elicitation-playbook.md');
  const line = elicit.split('\n').find((l) => l.includes('**Ask it as its own item'));
  assert.notEqual(line, undefined, 'the deploy-target example bullet is missing');
  const examples = [...line.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.equal(examples.length, 3, `expected three example answers, found ${examples.length}`);
  const key = (s) => s.toLowerCase();
  const sorted = [...examples].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  assert.deepEqual(examples, sorted, 'the example answers are not in alphabetical order');
  assert.match(line, /alphabetical order/i);
  assert.match(line, /not a ranking/i);
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

test('AC-805-4: the self-review is honestly scoped as an in-loop check subordinate to the independent gate', async () => {
  const playbook = await read('build-cycle-playbook.md');
  assert.match(playbook, /an in-loop check, not the independent verification gate/i);
  assert.match(playbook, /not a new subsystem/i);
  // Subordinate to the gate, and the gate is named: `rcf finalise`.
  assert.match(playbook, /the gate is `rcf build finalise` \(section 7\)/);
});

test('AC-805-4: no guidance claims the independent verification gate is still unbuilt', async () => {
  // rcf-verify-lite shipped (0.1.1) and `rcf finalise` runs it. Guidance
  // written before that said the gate did not exist yet, which made
  // section 16 contradict section 7. Guard the regression in both files.
  for (const file of ['build-cycle-playbook.md', 'harness-template.md']) {
    const text = await read(file);
    assert.equal(/until rcf-verify-lite/i.test(text), false, `${file} still claims the verification gate does not exist`);
    // Carve-out: FBS-014's own title ("... interim self-review |") appears
    // verbatim inside the section 10 queue capture. A captured document
    // title is tree data on display, not guidance framing the self-review
    // as interim - only prose uses of the word are the regression.
    assert.equal(/interim(?! self-review \|)/i.test(text), false, `${file} still frames the self-review as interim`);
  }
});

// Fragment carries the deploy-aware and runtime-honest RULE blocks.
test('the harness fragment carries the local-preview and runtime-provenance rules (RULE 6, RULE 7)', async () => {
  const fragment = await loadHarnessFragment();
  assert.match(fragment, /RULE 6: Every build lands a local preview/);
  assert.match(fragment, /RULE 7: Verification claims name their runtime/);
});
