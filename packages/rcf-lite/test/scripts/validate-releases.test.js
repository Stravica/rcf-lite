// Update-awareness spec section 1.3: the prepublishOnly validator on the
// release feed. These tests exercise the pure `validateFeed` function
// against valid and invalid feed shapes to lock in the field contract.
//
// The live feed at packages/rcf-lite/releases/releases.yaml is also
// exercised end-to-end so a real edit that breaks a shape rule is
// caught by `pnpm -r test`, not only at prepublishOnly time.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as loadYaml } from 'js-yaml';

import { validateFeed, compareSemver, parseSemver } from '../../scripts/validate-releases.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(here, '..', '..');
const FEED_PATH = resolve(PACKAGE_ROOT, 'releases', 'releases.yaml');
const PACKAGE_JSON_PATH = resolve(PACKAGE_ROOT, 'package.json');

function makeEntry(overrides = {}) {
  return {
    version: '1.0.0',
    date: '2026-01-01',
    breaking: false,
    headlines: ['A perfectly plain-language sentence with a terminal period.'],
    minAgentAction: null,
    ...overrides,
  };
}

function makeFeed(overrides = {}) {
  const top = makeEntry();
  return {
    feedVersion: 1,
    latest: top.version,
    releases: [top],
    ...overrides,
  };
}

test('parseSemver accepts the canonical shape', () => {
  assert.deepEqual(parseSemver('0.12.0'), [0, 12, 0, '']);
  assert.deepEqual(parseSemver('1.2.3'), [1, 2, 3, '']);
  assert.deepEqual(parseSemver('1.0.0-rc.1'), [1, 0, 0, 'rc.1']);
  assert.equal(parseSemver('v1.0.0'), null);
  assert.equal(parseSemver('1.0'), null);
});

test('compareSemver orders by major, minor, patch, then pre-release', () => {
  assert.ok(compareSemver('0.12.0', '0.11.0') > 0);
  assert.ok(compareSemver('0.10.0', '0.9.0') > 0);
  assert.ok(compareSemver('1.0.0', '0.99.99') > 0);
  assert.equal(compareSemver('1.0.0', '1.0.0'), 0);
  assert.ok(compareSemver('1.0.0', '1.0.0-rc.1') > 0);
});

test('validateFeed passes on a minimal well-formed feed', () => {
  const findings = validateFeed(makeFeed(), '1.0.0');
  assert.deepEqual(findings, []);
});

test('validateFeed refuses when the top entry disagrees with package.json', () => {
  const findings = validateFeed(makeFeed(), '2.0.0');
  assert.equal(findings.length, 1);
  assert.match(findings[0], /must match package\.json version/);
});

test('validateFeed refuses a non-1 feedVersion', () => {
  const findings = validateFeed(makeFeed({ feedVersion: 2 }), '1.0.0');
  assert.ok(findings.some((f) => /feedVersion must be 1/.test(f)));
});

test('validateFeed refuses when latest does not equal releases[0].version', () => {
  const findings = validateFeed(makeFeed({ latest: '0.9.9' }), '1.0.0');
  assert.ok(findings.some((f) => /latest must equal releases\[0\]\.version/.test(f)));
});

test('validateFeed refuses a headline without a terminal period', () => {
  const feed = makeFeed({
    releases: [makeEntry({ headlines: ['no terminal punctuation'] })],
  });
  const findings = validateFeed(feed, '1.0.0');
  assert.ok(findings.some((f) => /must end with a terminal period/.test(f)));
});

test('validateFeed refuses an empty headlines array', () => {
  const feed = makeFeed({
    releases: [makeEntry({ headlines: [] })],
  });
  const findings = validateFeed(feed, '1.0.0');
  assert.ok(findings.some((f) => /headlines must be a non-empty array/.test(f)));
});

test('validateFeed refuses more than three headlines', () => {
  const feed = makeFeed({
    releases: [
      makeEntry({
        headlines: [
          'One well-formed sentence.',
          'Two well-formed sentences.',
          'Three well-formed sentences.',
          'Four is one too many.',
        ],
      }),
    ],
  });
  const findings = validateFeed(feed, '1.0.0');
  assert.ok(findings.some((f) => /one to three/.test(f)));
});

test('validateFeed refuses a missing breaking flag', () => {
  const entry = makeEntry();
  delete entry.breaking;
  const feed = makeFeed({ releases: [entry] });
  const findings = validateFeed(feed, '1.0.0');
  assert.ok(findings.some((f) => /breaking must be a boolean/.test(f)));
});

test('validateFeed refuses a non-ISO date', () => {
  const feed = makeFeed({
    releases: [makeEntry({ date: '2026-1-1' })],
  });
  const findings = validateFeed(feed, '1.0.0');
  assert.ok(findings.some((f) => /date must be YYYY-MM-DD/.test(f)));
});

test('validateFeed refuses an unknown minAgentAction', () => {
  const feed = makeFeed({
    releases: [makeEntry({ minAgentAction: 'invent-a-value' })],
  });
  const findings = validateFeed(feed, '1.0.0');
  assert.ok(findings.some((f) => /minAgentAction must be null or one of/.test(f)));
});

test('validateFeed accepts every enumerated minAgentAction and null', () => {
  const values = [null, 'rewrite-shell-invocations', 'rerun-init', 'regenerate-chain', 'schema-migration'];
  for (const value of values) {
    const feed = makeFeed({
      releases: [makeEntry({ minAgentAction: value })],
    });
    assert.deepEqual(validateFeed(feed, '1.0.0'), [], `expected ${JSON.stringify(value)} to be accepted`);
  }
});

test('validateFeed refuses newest-not-first ordering', () => {
  const feed = {
    feedVersion: 1,
    latest: '0.9.0',
    releases: [
      makeEntry({ version: '0.9.0', date: '2026-08-25' }),
      makeEntry({ version: '0.12.0', date: '2026-08-28' }),
    ],
  };
  const findings = validateFeed(feed, '0.9.0');
  assert.ok(findings.some((f) => /ordered newest-first by semver/.test(f)));
});

test('validateFeed refuses duplicate versions', () => {
  const feed = {
    feedVersion: 1,
    latest: '1.0.0',
    releases: [
      makeEntry({ version: '1.0.0', date: '2026-02-01' }),
      makeEntry({ version: '1.0.0', date: '2026-01-01' }),
    ],
  };
  const findings = validateFeed(feed, '1.0.0');
  assert.ok(findings.some((f) => /is a duplicate/.test(f)));
});

test('the shipped releases.yaml validates against the shipped package.json', async () => {
  const [feedSource, pkgSource] = await Promise.all([
    readFile(FEED_PATH, 'utf8'),
    readFile(PACKAGE_JSON_PATH, 'utf8'),
  ]);
  const feed = loadYaml(feedSource);
  const pkg = JSON.parse(pkgSource);
  const findings = validateFeed(feed, pkg.version);
  assert.deepEqual(findings, [], `live feed rejected: ${findings.join('; ')}`);
});
