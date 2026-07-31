// Track C+D §8: never-skip-RCF invariant lands byte-identically in
// three surfaces. The register-regression canary catches wording drift
// downstream via `bypassOffer`; this test locks the byte-identity of
// the invariant paragraph across:
//   1. packages/build/guidance/elicitation-playbook.md §11.1
//   2. packages/build/guidance/build-cycle-playbook.md §13 opener
//   3. packages/build/guidance/manifest.json platformInvariants[0].text
//
// Any edit to one surface without the same edit to the other two fails
// this test. That is the point.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GUIDANCE_DIR = resolve(here, '..', '..', 'guidance');

// The canonical paragraph, byte-for-byte per spec §8.2.
const INVARIANT_TEXT = 'Never-skip-RCF. The bug-fix loop uses the same five-stage cycle as the initial build (Define, Build, Review, Test, Finalise); there is no fast-path, and there is no operator ruling that opens one. Do not offer a shortcut. Do not phrase the choice as "would you rather I skip the RCF wrapping" or any wording that presents bypassing the chain as a legitimate option. The offer itself is the defect. The operator\'s refusal is not a sign the invariant held; it is a sign the invariant was tested and the guidance surface leaked. Fix the guidance surface.';

test('elicitation-playbook.md §11.1 carries the invariant paragraph byte-identically', async () => {
  const text = await readFile(join(GUIDANCE_DIR, 'elicitation-playbook.md'), 'utf8');
  assert.ok(text.includes(`## 11.1 Never-skip-RCF`), 'expected §11.1 heading');
  // The playbook markdown wraps the first token in bold; the raw
  // invariant text sans markdown emphasis is what the platform contract
  // pins. Strip a leading `**Never-skip-RCF.**` re-emphasis and match
  // against the canonical body.
  const idx = text.indexOf(INVARIANT_TEXT);
  // Fallback: allow a bold prefix on the leading marker.
  const boldIdx = text.indexOf(`**Never-skip-RCF.**${INVARIANT_TEXT.slice('Never-skip-RCF.'.length)}`);
  assert.ok(idx !== -1 || boldIdx !== -1, 'expected the byte-identical invariant paragraph in elicitation-playbook.md');
});

test('build-cycle-playbook.md §13 opens with the invariant paragraph byte-identically', async () => {
  const text = await readFile(join(GUIDANCE_DIR, 'build-cycle-playbook.md'), 'utf8');
  assert.ok(text.includes('## 13. Triage a bug back to the spec first'), 'expected §13 heading');
  const idx = text.indexOf(INVARIANT_TEXT);
  const boldIdx = text.indexOf(`**Never-skip-RCF.**${INVARIANT_TEXT.slice('Never-skip-RCF.'.length)}`);
  assert.ok(idx !== -1 || boldIdx !== -1, 'expected the byte-identical invariant paragraph in build-cycle-playbook.md §13');
});

test('manifest.json platformInvariants[0].text carries the invariant paragraph byte-identically', async () => {
  const raw = await readFile(join(GUIDANCE_DIR, 'manifest.json'), 'utf8');
  const manifest = JSON.parse(raw);
  assert.ok(Array.isArray(manifest.platformInvariants), 'manifest.platformInvariants must exist');
  assert.equal(manifest.platformInvariants.length >= 1, true);
  assert.equal(manifest.platformInvariants[0].id, 'never-skip-rcf');
  assert.equal(manifest.platformInvariants[0].title, 'Never-skip-RCF');
  assert.equal(manifest.platformInvariants[0].text, INVARIANT_TEXT, 'manifest invariant text must match the canonical paragraph byte-for-byte');
});

// Deliberately omitted: a "canary passes on the invariant text" test.
// The invariant quotes the exact bypass-offer phrases the canary greps
// for (that is the point of the invariant — it names what an agent
// must not say). Running the invariant text through the canary would
// fail bypassOffer, but that failure is a category error: the canary
// grades AGENT RESPONSES, not the guidance surface. A subagent that
// quoted the invariant verbatim in its own first response would
// legitimately trip the canary; the fix in that case is a shorter
// paraphrase, not a wording change to the invariant itself.
