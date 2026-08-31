#!/usr/bin/env node
// Release-feed validator (update-awareness spec section 1.3).
//
// Runs at prepublishOnly time. Refuses publish when the release feed
// (`packages/rcf-lite/releases/releases.yaml`) is inconsistent with the
// package.json version being published, or when any release entry does
// not meet the field contract in the spec (section 1.1).
//
// Invariants checked:
//   1. `feedVersion` is 1.
//   2. `latest` matches the first entry in `releases`.
//   3. The first entry's `version` matches `package.json.version`, so a
//      release cannot ship without its own entry in the feed.
//   4. Every release has version, date, breaking, headlines,
//      minAgentAction (the field-contract required set from spec 1.1).
//   5. `version` is a valid semver (strict; no build metadata handling).
//   6. `date` is YYYY-MM-DD.
//   7. `headlines` is a non-empty array of non-empty strings; each ends
//      with a terminal period.
//   8. `breaking` is a boolean.
//   9. `minAgentAction` is null or one of the enumerated values.
//  10. `releases` is ordered newest-first by semver (spec 2.7 "semver
//      ordering wins over date ordering").
//  11. No duplicate versions.
//
// Exit codes:
//   0: all checks pass.
//   1: one or more findings; every finding printed to stderr, then a
//      summary count.
//
// The validator is deliberately noisy: publish is refused on the first
// broken invariant, but the caller sees every failure at once so a
// release-time fix is one edit, not a ping-pong.

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as loadYaml } from 'js-yaml';

const here = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(here, '..');
const FEED_PATH = resolve(PACKAGE_ROOT, 'releases', 'releases.yaml');
const PACKAGE_JSON_PATH = resolve(PACKAGE_ROOT, 'package.json');

const MIN_AGENT_ACTIONS = new Set([
  'rewrite-shell-invocations',
  'rerun-init',
  'regenerate-chain',
  'schema-migration',
]);

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\w.-]+))?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse a strict semver string into an ordering tuple. Returns null when
 * the string is not a valid semver.
 *
 * @param {string} version
 * @returns {[number, number, number, string] | null}
 */
export function parseSemver(version) {
  const match = SEMVER.exec(version);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ?? ''];
}

/**
 * Compare two semver strings. Returns > 0 when a is newer than b, < 0
 * when older, 0 when equal. Pre-release tags order alphabetically after
 * an absent tag (e.g. 1.0.0 > 1.0.0-rc.1).
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) throw new Error(`compareSemver: invalid semver ${!pa ? a : b}`);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  // Pre-release tags: a release with no tag is newer than one with a tag.
  const [, , , ta] = pa;
  const [, , , tb] = pb;
  if (ta === tb) return 0;
  if (ta === '') return 1;
  if (tb === '') return -1;
  return ta < tb ? -1 : 1;
}

/**
 * Run every invariant check against the loaded feed and the current
 * package.json version. Returns the array of findings; empty when clean.
 *
 * @param {unknown} feed
 * @param {string} packageVersion
 * @returns {string[]}
 */
export function validateFeed(feed, packageVersion) {
  const findings = [];
  if (!feed || typeof feed !== 'object') {
    findings.push('feed is not an object');
    return findings;
  }
  const { feedVersion, latest, releases } = /** @type {Record<string, unknown>} */ (feed);
  if (feedVersion !== 1) {
    findings.push(`feedVersion must be 1 (found ${JSON.stringify(feedVersion)})`);
  }
  if (!Array.isArray(releases) || releases.length === 0) {
    findings.push('releases must be a non-empty array');
    return findings;
  }
  const seenVersions = new Set();
  releases.forEach((entry, index) => {
    const where = `releases[${index}]`;
    if (!entry || typeof entry !== 'object') {
      findings.push(`${where}: entry is not an object`);
      return;
    }
    const rec = /** @type {Record<string, unknown>} */ (entry);
    const version = rec.version;
    if (typeof version !== 'string' || !SEMVER.test(version)) {
      findings.push(`${where}.version must be a valid semver string (found ${JSON.stringify(version)})`);
    } else if (seenVersions.has(version)) {
      findings.push(`${where}.version ${version} is a duplicate`);
    } else {
      seenVersions.add(version);
    }
    if (typeof rec.date !== 'string' || !ISO_DATE.test(rec.date)) {
      findings.push(`${where}.date must be YYYY-MM-DD (found ${JSON.stringify(rec.date)})`);
    }
    if (typeof rec.breaking !== 'boolean') {
      findings.push(`${where}.breaking must be a boolean (found ${JSON.stringify(rec.breaking)})`);
    }
    if (!Array.isArray(rec.headlines) || rec.headlines.length === 0) {
      findings.push(`${where}.headlines must be a non-empty array`);
    } else {
      rec.headlines.forEach((line, lineIdx) => {
        if (typeof line !== 'string' || line.length === 0) {
          findings.push(`${where}.headlines[${lineIdx}] must be a non-empty string`);
        } else if (!/[.?!]$/.test(line)) {
          findings.push(`${where}.headlines[${lineIdx}] must end with a terminal period (found ${JSON.stringify(line.slice(-1))})`);
        }
      });
      if (rec.headlines.length > 3) {
        findings.push(`${where}.headlines has ${rec.headlines.length} entries; the spec asks for one to three`);
      }
    }
    if (!(rec.minAgentAction === null || (typeof rec.minAgentAction === 'string' && MIN_AGENT_ACTIONS.has(rec.minAgentAction)))) {
      findings.push(`${where}.minAgentAction must be null or one of ${[...MIN_AGENT_ACTIONS].join(', ')} (found ${JSON.stringify(rec.minAgentAction)})`);
    }
    if (rec.notesUrl !== undefined && typeof rec.notesUrl !== 'string') {
      findings.push(`${where}.notesUrl must be a string when present (found ${JSON.stringify(rec.notesUrl)})`);
    }
  });

  const versions = releases
    .filter((entry) => entry && typeof entry === 'object' && typeof (/** @type {{ version?: unknown }} */ (entry)).version === 'string')
    .map((entry) => /** @type {string} */ (/** @type {{ version?: unknown }} */ (entry).version));
  for (let i = 1; i < versions.length; i += 1) {
    if (SEMVER.test(versions[i - 1]) && SEMVER.test(versions[i]) && compareSemver(versions[i - 1], versions[i]) <= 0) {
      findings.push(`releases must be ordered newest-first by semver; ${versions[i - 1]} is not strictly newer than ${versions[i]}`);
    }
  }
  const topVersion = versions[0];
  if (typeof latest !== 'string' || latest !== topVersion) {
    findings.push(`latest must equal releases[0].version (latest=${JSON.stringify(latest)}, top=${JSON.stringify(topVersion)})`);
  }
  if (topVersion && topVersion !== packageVersion) {
    findings.push(`releases[0].version (${topVersion}) must match package.json version (${packageVersion}); add the new release's entry to the feed`);
  }
  return findings;
}

async function main() {
  let source;
  try {
    source = await readFile(FEED_PATH, 'utf8');
  } catch (err) {
    console.error(`validate-releases: cannot read ${FEED_PATH}: ${err.message}`);
    process.exit(1);
  }
  let feed;
  try {
    feed = loadYaml(source);
  } catch (err) {
    console.error(`validate-releases: cannot parse ${FEED_PATH} as YAML: ${err.message}`);
    process.exit(1);
  }
  const pkg = JSON.parse(await readFile(PACKAGE_JSON_PATH, 'utf8'));
  const findings = validateFeed(feed, pkg.version);
  if (findings.length === 0) {
    console.log(`validate-releases: OK (top version ${pkg.version}, ${feed.releases.length} entries)`);
    process.exit(0);
  }
  for (const line of findings) console.error(`validate-releases: ${line}`);
  console.error(`validate-releases: ${findings.length} finding${findings.length === 1 ? '' : 's'}; release refused`);
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`validate-releases: unexpected error: ${err.stack || err.message}`);
    process.exit(1);
  });
}
