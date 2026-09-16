// AC-16201-1 (US-16201, REQ-162, FBS-185): the RULE 17 slice of the
// canonical managed block is byte-for-byte identical to the design
// section 3.4 fixture at test/fixtures/managed/rule-17.md, so a wording
// drift on ship is caught by CI rather than in a shipped block hash bump.
//
// A companion assertion covers the four verb names and the redaction
// posture sentence, since design section 3.4 makes both load-bearing:
// an agent under pace still follows the shape when the harness hook is
// not trusted, and the four verbs (preview, submit --yes, defer,
// opt-out) are the whole disposition surface.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(here, '..', '..');
const CANONICAL_PATH = resolve(PACKAGE_ROOT, 'guidance', 'managed', 'agent-instructions-block.md');
const FIXTURE_PATH = resolve(PACKAGE_ROOT, 'test', 'fixtures', 'managed', 'rule-17.md');

/**
 * Return the RULE 17 slice of the block: from `### RULE 17:` up to
 * (but not including) the next `### ` header. Trailing blank lines are
 * collapsed to a single `\n` so the byte-exact compare survives a stray
 * blank line above the following heading without weakening the check.
 *
 * @param {string} block
 * @returns {string}
 */
function extractRule17Slice(block) {
  const start = block.indexOf('### RULE 17:');
  if (start === -1) throw new Error('RULE 17 heading missing from block');
  const after = block.indexOf('\n### ', start + 1);
  if (after === -1) throw new Error('no heading follows RULE 17 in block');
  return `${block.slice(start, after).replace(/\n+$/, '')}\n`;
}

test('AC-16201-1: the RULE 17 slice of the block is byte-for-byte the fixture', async () => {
  const [block, fixture] = await Promise.all([
    readFile(CANONICAL_PATH, 'utf8'),
    readFile(FIXTURE_PATH, 'utf8'),
  ]);
  const slice = extractRule17Slice(block);
  assert.equal(slice, fixture, 'RULE 17 slice drift: regenerate the fixture only when the design intentionally changes the wording');
});

test('AC-16201-1: RULE 17 names all four verbs and the redaction posture', async () => {
  const block = await readFile(CANONICAL_PATH, 'utf8');
  const slice = extractRule17Slice(block);
  // Four verb names (verbatim; the ask verbs the hook.js stop reason relays).
  assert.match(slice, /`rcf feedback add`/);
  assert.match(slice, /`rcf feedback preview`/);
  assert.match(slice, /`rcf feedback submit --yes`/);
  assert.match(slice, /`rcf feedback defer`/);
  assert.match(slice, /`rcf feedback opt-out`/);
  // Redaction posture: the tool redacts, the agent does not rely on it.
  assert.match(slice, /the tool redacts, you do not rely on it/);
  // One-ask-per-session posture (belt-and-braces to the hook).
  assert.match(slice, /Ask exactly once per session/);
  assert.match(slice, /Do not ask again in the same session/);
});

test('AC-16201-1: RULE 17 carries no em-dash and no version or date string', async () => {
  const fixture = await readFile(FIXTURE_PATH, 'utf8');
  assert.equal(/—/.test(fixture), false, 'em-dash present in RULE 17 fixture');
  // Static wording rule (design 3.4): no version numbers, no dates, so
  // the block hash moves exactly once on the release that ships the rule.
  assert.equal(/\b\d{4}-\d{2}-\d{2}\b/.test(fixture), false, 'ISO date present in RULE 17 fixture');
  assert.equal(/\b\d+\.\d+\.\d+\b/.test(fixture), false, 'semver present in RULE 17 fixture');
});
