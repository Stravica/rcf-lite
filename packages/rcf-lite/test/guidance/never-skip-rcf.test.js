// Track C+D §8: never-skip-RCF invariant lands byte-identically in
// three surfaces. The register-regression canary catches wording drift
// downstream via `bypassOffer`; this test locks the byte-identity of
// the invariant paragraph across:
//   1. packages/rcf-lite/guidance/elicitation-playbook.md §11.1
//   2. packages/rcf-lite/guidance/build-cycle-playbook.md §13 opener
//   3. packages/rcf-lite/guidance/manifest.json platformInvariants[0].text
//
// The reference passage lives at
// `test/guidance/fixtures/never-skip-rcf.spec-8-2.txt` (bytes copied
// verbatim from spec §8.2, kept as a plain text file so an operator can
// diff it against the spec without wading through JS-escape
// confusion). Every surface is compared byte-for-byte to that fixture.
//
// The `SPEC_8_2_TEXT` constant below duplicates the fixture on
// purpose: a first test cross-checks the constant against the fixture,
// so a wording drift in either half is caught even if the other half
// was never re-read. The point is to make drift-in-unison AND
// per-surface normalisation (dropping bold markers, changing quote
// style, splicing whitespace) both impossible to slip through.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GUIDANCE_DIR = resolve(here, '..', '..', 'guidance');
const FIXTURE_PATH = join(here, 'fixtures', 'never-skip-rcf.spec-8-2.txt');

// The canonical paragraph, byte-for-byte from spec §8.2. Bold markers
// included: the spec ships the passage with the `**Never-skip-RCF.**`
// leader intact, so every surface (including the JSON manifest, which
// carries the marker as literal asterisks) must too. Kept in sync with
// the fixture file above; the first test below catches any drift
// between the two.
const SPEC_8_2_TEXT = '**Never-skip-RCF.** The bug-fix loop uses the same five-stage cycle as the initial build (Define, Build, Review, Test, Finalise); there is no fast-path, and there is no operator ruling that opens one. Do not offer a shortcut. Do not phrase the choice as "would you rather I skip the RCF wrapping" or any wording that presents bypassing the chain as a legitimate option. The offer itself is the defect. The operator\'s refusal is not a sign the invariant held; it is a sign the invariant was tested and the guidance surface leaked. Fix the guidance surface.';

async function loadFixturePassage() {
  const raw = await readFile(FIXTURE_PATH, 'utf8');
  // The fixture is stored with a trailing newline for POSIX file
  // hygiene; the passage itself does not end with one.
  return raw.endsWith('\n') ? raw.slice(0, -1) : raw;
}

test('fixture and embedded constant match byte-for-byte (double-attestation)', async () => {
  const passage = await loadFixturePassage();
  assert.equal(
    passage,
    SPEC_8_2_TEXT,
    'fixture never-skip-rcf.spec-8-2.txt and SPEC_8_2_TEXT constant disagree; one drifted from the other. Both must equal the spec §8.2 passage byte-for-byte.',
  );
});

test('manifest.json platformInvariants[0].text equals the spec §8.2 passage byte-for-byte', async () => {
  const raw = await readFile(join(GUIDANCE_DIR, 'manifest.json'), 'utf8');
  const manifest = JSON.parse(raw);
  assert.ok(Array.isArray(manifest.platformInvariants), 'manifest.platformInvariants must exist');
  assert.equal(manifest.platformInvariants.length >= 1, true);
  assert.equal(manifest.platformInvariants[0].id, 'never-skip-rcf');
  assert.equal(manifest.platformInvariants[0].title, 'Never-skip-RCF');
  const passage = await loadFixturePassage();
  assert.equal(
    manifest.platformInvariants[0].text,
    passage,
    'manifest platformInvariants[0].text drifted from spec §8.2. Bold markers, quotes, semicolons and every byte in between must match.',
  );
});

test('elicitation-playbook.md §11.1 contains the spec §8.2 passage as a byte substring', async () => {
  const source = await readFile(join(GUIDANCE_DIR, 'elicitation-playbook.md'), 'utf8');
  assert.ok(source.includes('## 11.1 Never-skip-RCF'), 'expected §11.1 heading');
  const passage = await loadFixturePassage();
  const bytes = Buffer.from(source, 'utf8');
  const passageBytes = Buffer.from(passage, 'utf8');
  assert.notEqual(
    bytes.indexOf(passageBytes),
    -1,
    'elicitation-playbook.md §11.1 must carry the spec §8.2 passage byte-for-byte (including the `**Never-skip-RCF.**` bold leader).',
  );
});

test('build-cycle-playbook.md §13 contains the spec §8.2 passage as a byte substring', async () => {
  const source = await readFile(join(GUIDANCE_DIR, 'build-cycle-playbook.md'), 'utf8');
  assert.ok(source.includes('## 13. Triage a bug back to the spec first'), 'expected §13 heading');
  const passage = await loadFixturePassage();
  const bytes = Buffer.from(source, 'utf8');
  const passageBytes = Buffer.from(passage, 'utf8');
  assert.notEqual(
    bytes.indexOf(passageBytes),
    -1,
    'build-cycle-playbook.md §13 must carry the spec §8.2 passage byte-for-byte (including the `**Never-skip-RCF.**` bold leader).',
  );
});

// Deliberately omitted: a "canary passes on the invariant text" test.
// The invariant quotes the exact bypass-offer phrases the canary greps
// for (that is the point of the invariant - it names what an agent
// must not say). Running the invariant text through the canary would
// fail bypassOffer, but that failure is a category error: the canary
// grades AGENT RESPONSES, not the guidance surface. A subagent that
// quoted the invariant verbatim in its own first response would
// legitimately trip the canary; the fix in that case is a shorter
// paraphrase, not a wording change to the invariant itself.
