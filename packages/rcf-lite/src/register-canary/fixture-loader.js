// Fixture-pack loader for the register canary (spec §7.3).
//
// The fixture pack ships in `#core/fixtures/register-canary`.
// This loader reads each file by id, verifies the shape the runner
// consumes, and returns the pack in canonical order. Operators can
// extend the pack via a local `fixtures/register-canary/*.json` in
// their own project; the loader accepts an override directory for that.

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Canonical fixture ids that ship in the core pack (spec §7.3). */
export const DEFAULT_FIXTURE_IDS = Object.freeze([
  'canary-prompt-01',
  'canary-prompt-02',
  'canary-prompt-03',
]);

/**
 * Locate the core fixture directory. Post-0.7.1 consolidation the core src
 * lives inline under `src/core/`, so the loader (which sits at
 * `src/register-canary/`) can reach the fixture pack via a single relative
 * walk. `RCF_CANARY_FIXTURE_DIR` still overrides for tests and operators.
 *
 * @returns {string}
 */
export function defaultFixtureDir() {
  // src/register-canary/ -> up one -> src/ -> core/fixtures/register-canary.
  // Same relative shape in dev and inside the published tarball because the
  // umbrella ships src/ verbatim (no build step). See package.json `files`.
  const fixtureCandidate = join(here, '..', 'core', 'fixtures', 'register-canary');
  return process.env.RCF_CANARY_FIXTURE_DIR ?? fixtureCandidate;
}

/**
 * @typedef {object} CanaryFixture
 * @property {string} id
 * @property {string} operatorPrompt
 * @property {Array<{ path: string, content: string }>} [supportingArtefacts]
 * @property {string[]} grantedPermissions
 * @property {number} wordCountBudget
 * @property {string} [notes]
 */

/**
 * Load a fixture pack from a directory. Reads every *.json file in
 * canonical order; the ids must be unique. Overrides via env
 * `RCF_CANARY_FIXTURE_DIR` (used by tests).
 *
 * @param {string} [dir]
 * @returns {Promise<CanaryFixture[]>}
 */
export async function loadFixturePack(dir = defaultFixtureDir()) {
  const files = (await readdir(dir))
    .filter((n) => n.endsWith('.json'))
    .sort();
  const fixtures = [];
  const ids = new Set();
  for (const name of files) {
    const abs = join(dir, name);
    const raw = await readFile(abs, 'utf8');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(`register-canary fixture ${name}: JSON parse failed: ${err.message}`);
    }
    if (typeof parsed?.id !== 'string' || parsed.id.length === 0) {
      throw new Error(`register-canary fixture ${name}: missing id`);
    }
    if (ids.has(parsed.id)) {
      throw new Error(`register-canary fixture ${name}: duplicate id ${parsed.id}`);
    }
    ids.add(parsed.id);
    if (typeof parsed?.operatorPrompt !== 'string' || parsed.operatorPrompt.length === 0) {
      throw new Error(`register-canary fixture ${parsed.id}: missing operatorPrompt`);
    }
    if (!Array.isArray(parsed?.grantedPermissions)) {
      throw new Error(`register-canary fixture ${parsed.id}: grantedPermissions must be an array`);
    }
    fixtures.push(parsed);
  }
  return fixtures;
}
