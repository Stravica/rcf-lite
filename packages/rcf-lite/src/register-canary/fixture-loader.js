// Fixture-pack loader for the register canary (spec §7.3).
//
// The fixture pack ships in `@stravica-ai/rcf-lite-core/fixtures/register-canary`.
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
 * Locate the core fixture directory by walking up from this module and
 * resolving into `packages/core/src/fixtures/register-canary`. Falls
 * back to the workspace path when the packages are hoisted, and to the
 * installed node_modules path when running from a consumer.
 *
 * @returns {string}
 */
export function defaultFixtureDir() {
  // Monorepo path: build package sits under packages/build/src, so
  // three levels up is the monorepo root.
  const monorepoCandidate = join(here, '..', '..', '..', 'core', 'src', 'fixtures', 'register-canary');
  // Installed-package path: node_modules resolution.
  const installedCandidate = join(here, '..', '..', 'node_modules', '@stravica-ai', 'rcf-lite-core', 'src', 'fixtures', 'register-canary');
  return process.env.RCF_CANARY_FIXTURE_DIR ?? monorepoCandidate ?? installedCandidate;
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
