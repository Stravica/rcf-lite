// `rcf version` + `rcf version --check` behavioural tests. Serves a
// fixture feed over a local HTTP server so every network path is real:
// success, non-2xx, malformed JSON, timeout, higher feedVersion. Then
// exercises the cache stamp, kill-switch, and semver primitives.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  compareSemver,
  parseSemver,
  isValidFeed,
  isUsableFeed,
  compareInstalledToFeed,
  formatHuman,
  formatJson,
  resolveCacheDir,
  resolveConfigDir,
  isKillSwitchOn,
  fetchFeed,
  KNOWN_FEED_VERSION,
  main as versionMain,
} from '../../src/cli/version.js';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '..', '..');
const bin = join(packageRoot, 'bin', 'rcf.js');

// ---------------------------------------------------------------------------
// Fixture feeds.
// ---------------------------------------------------------------------------

const feedNewerAvailable = {
  feedVersion: 1,
  generated: '2026-09-01T09:00:00Z',
  latest: '0.14.0',
  releases: [
    {
      version: '0.14.0',
      date: '2026-09-01',
      breaking: false,
      headlines: ['Coverage rollup adds a per-FBS confidence line.'],
      minAgentAction: null,
      notesUrl: 'https://stravica.ai/docs/rcf/changelog/#0-14-0',
    },
    {
      version: '0.13.5',
      date: '2026-08-30',
      breaking: false,
      headlines: ['Doctor now catches unpaired managed-block markers.'],
      minAgentAction: 'rerun-init',
      notesUrl: 'https://stravica.ai/docs/rcf/changelog/#0-13-5',
    },
    {
      version: '0.13.0',
      date: '2026-08-28',
      breaking: false,
      headlines: ['Packaging fixes for a first-time install.'],
      minAgentAction: null,
      notesUrl: 'https://stravica.ai/docs/rcf/changelog/#0-13-0',
    },
  ],
};

const feedUpToDate = {
  feedVersion: 1,
  generated: '2026-09-01T09:00:00Z',
  latest: '0.13.0',
  releases: [
    {
      version: '0.13.0',
      date: '2026-08-28',
      breaking: false,
      headlines: ['Packaging fixes.'],
      minAgentAction: null,
    },
  ],
};

const feedPlaceholder = {
  feedVersion: 1,
  generated: '2026-08-31T12:00:00Z',
  latest: null,
  releases: [],
};

const feedFutureVersion = {
  feedVersion: 999,
  generated: '2026-09-01T09:00:00Z',
  latest: '99.0.0',
  releases: [{ version: '99.0.0', date: '2026-09-01', breaking: false, headlines: ['x'], minAgentAction: null }],
};

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/** Serve one body once (or forever) on a local HTTP server. */
async function serveOnce({ status = 200, body, contentType = 'application/json', hangMs = 0 } = {}) {
  const server = createServer((req, res) => {
    if (hangMs > 0) {
      // Deliberately never respond -- used for timeout tests.
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(body);
      }, hangMs);
      return;
    }
    res.writeHead(status, { 'Content-Type': contentType });
    res.end(body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/releases.json`,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

async function tempDirs() {
  const root = await mkdtemp(join(tmpdir(), 'rcf-version-'));
  const cacheDir = join(root, 'cache');
  const configDir = join(root, 'config');
  await mkdir(cacheDir, { recursive: true });
  await mkdir(configDir, { recursive: true });
  return { root, cacheDir, configDir };
}

function captureStreams() {
  const out = [];
  const err = [];
  return {
    stdout: { write: (s) => { out.push(String(s)); return true; } },
    stderr: { write: (s) => { err.push(String(s)); return true; } },
    getOut: () => out.join(''),
    getErr: () => err.join(''),
  };
}

async function runBin(cwd, args, extraEnv = {}) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [bin, ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, ...extraEnv, CI: '1' },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

// ---------------------------------------------------------------------------
// Semver primitives.
// ---------------------------------------------------------------------------

test('parseSemver accepts well-formed semvers and rejects garbage', () => {
  assert.ok(parseSemver('0.13.0'));
  assert.ok(parseSemver('1.2.3-alpha.1'));
  assert.equal(parseSemver('not-a-version'), null);
  assert.equal(parseSemver('1.2'), null);
  assert.equal(parseSemver(''), null);
});

test('compareSemver ranks releases correctly', () => {
  assert.equal(compareSemver('0.13.0', '0.13.0'), 0);
  assert.equal(compareSemver('0.13.0', '0.14.0'), -1);
  assert.equal(compareSemver('0.14.0', '0.13.0'), 1);
  assert.equal(compareSemver('0.13.10', '0.13.9'), 1);
  assert.equal(compareSemver('0.13.0-rc.1', '0.13.0'), -1);
  assert.equal(compareSemver('0.13.0-alpha', '0.13.0-alpha.1'), -1);
  assert.equal(compareSemver('0.13.0-alpha.1', '0.13.0-alpha.2'), -1);
});

// ---------------------------------------------------------------------------
// Feed shape validation.
// ---------------------------------------------------------------------------

test('isValidFeed accepts the spec-shaped feed', () => {
  assert.equal(isValidFeed(feedNewerAvailable), true);
  assert.equal(isValidFeed(feedPlaceholder), true);
});

test('isValidFeed rejects malformed shapes', () => {
  assert.equal(isValidFeed(null), false);
  assert.equal(isValidFeed({}), false);
  assert.equal(isValidFeed({ feedVersion: 1 }), false);
  assert.equal(isValidFeed({ ...feedUpToDate, releases: 'not-an-array' }), false);
});

test('isUsableFeed rejects a higher feedVersion (forward-compat guard)', () => {
  assert.equal(isUsableFeed(feedFutureVersion), false);
  assert.equal(isUsableFeed(feedNewerAvailable), true);
});

// ---------------------------------------------------------------------------
// compareInstalledToFeed envelope.
// ---------------------------------------------------------------------------

test('compareInstalledToFeed detects behind + collects releases ahead', () => {
  const r = compareInstalledToFeed('0.13.0', feedNewerAvailable, 'network', '2026-09-01T09:14:22Z');
  assert.equal(r.status, 'behind');
  assert.equal(r.latest, '0.14.0');
  assert.equal(r.releasesAhead.length, 2);
  assert.equal(r.releasesAhead[0].version, '0.14.0');
  assert.equal(r.releasesAhead[1].version, '0.13.5');
});

test('compareInstalledToFeed detects current', () => {
  const r = compareInstalledToFeed('0.13.0', feedUpToDate, 'network', 'x');
  assert.equal(r.status, 'current');
  assert.equal(r.releasesAhead.length, 0);
});

test('compareInstalledToFeed detects ahead when installed > feed latest', () => {
  const r = compareInstalledToFeed('9.9.9', feedNewerAvailable, 'network', 'x');
  assert.equal(r.status, 'ahead');
  assert.equal(r.releasesAhead.length, 0);
});

test('compareInstalledToFeed returns unknown for a placeholder feed (latest:null)', () => {
  const r = compareInstalledToFeed('0.13.0', feedPlaceholder, 'network', 'x');
  assert.equal(r.status, 'unknown');
  assert.equal(r.latest, null);
});

test('compareInstalledToFeed is downgrade-safe when the feed order is dishonest', () => {
  // A feed that lists 0.12.0 as newest first (date-newer) but 0.14.0 exists
  // further down. Semver must win.
  const dishonest = {
    feedVersion: 1,
    generated: 'x',
    latest: '0.12.0',
    releases: [
      { version: '0.12.0', date: '2026-09-05', breaking: false, headlines: ['recent'], minAgentAction: null },
      { version: '0.14.0', date: '2026-09-01', breaking: false, headlines: ['newer'], minAgentAction: null },
    ],
  };
  const r = compareInstalledToFeed('0.13.0', dishonest, 'network', 'x');
  assert.equal(r.status, 'behind');
  assert.equal(r.latest, '0.14.0');
});

// ---------------------------------------------------------------------------
// Cache / config path resolution.
// ---------------------------------------------------------------------------

test('resolveCacheDir + resolveConfigDir produce absolute per-platform paths', () => {
  const cache = resolveCacheDir({ HOME: '/home/x' });
  const config = resolveConfigDir({ HOME: '/home/x' });
  assert.ok(cache.startsWith('/'));
  assert.ok(config.startsWith('/'));
  assert.ok(cache.endsWith('rcf-lite') || cache.endsWith('rcf-lite/Cache'));
});

test('isKillSwitchOn honours env var and config file', () => {
  assert.equal(isKillSwitchOn({}, {}), false);
  assert.equal(isKillSwitchOn({ RCF_UPDATE_CHECK: 'off' }, {}), true);
  assert.equal(isKillSwitchOn({}, { updateCheck: 'off' }), true);
  assert.equal(isKillSwitchOn({ RCF_UPDATE_CHECK: 'on' }, {}), false);
});

// ---------------------------------------------------------------------------
// fetchFeed against a real local HTTP server.
// ---------------------------------------------------------------------------

test('fetchFeed returns the feed when the URL serves valid JSON', async () => {
  const s = await serveOnce({ body: JSON.stringify(feedNewerAvailable) });
  try {
    const feed = await fetchFeed(s.url);
    assert.equal(feed.latest, '0.14.0');
  } finally {
    await s.close();
  }
});

test('fetchFeed returns null for a 500 response', async () => {
  const s = await serveOnce({ status: 500, body: 'boom' });
  try {
    assert.equal(await fetchFeed(s.url), null);
  } finally {
    await s.close();
  }
});

test('fetchFeed returns null for malformed JSON', async () => {
  const s = await serveOnce({ body: '{not json' });
  try {
    assert.equal(await fetchFeed(s.url), null);
  } finally {
    await s.close();
  }
});

test('fetchFeed returns null when the feedVersion is higher than known', async () => {
  const s = await serveOnce({ body: JSON.stringify(feedFutureVersion) });
  try {
    assert.equal(await fetchFeed(s.url), null);
  } finally {
    await s.close();
  }
});

test('fetchFeed aborts on the configured timeout', async () => {
  const s = await serveOnce({ body: '{}', hangMs: 5_000 });
  try {
    const t0 = Date.now();
    const feed = await fetchFeed(s.url, { timeoutMs: 150 });
    const elapsed = Date.now() - t0;
    assert.equal(feed, null);
    assert.ok(elapsed < 1_000, `timeout took too long: ${elapsed}ms`);
  } finally {
    await s.close();
  }
});

// ---------------------------------------------------------------------------
// Main dispatch: bare version, --check paths, caching, kill-switch.
// ---------------------------------------------------------------------------

test('rcf version (bare) prints rcf-lite <installed> and exits 0, no network', async () => {
  const cap = captureStreams();
  let fetchCalled = false;
  const code = await versionMain([], {
    ...cap,
    installedVersion: '0.13.0',
    fetch: async () => { fetchCalled = true; return null; },
  });
  assert.equal(code, 0);
  assert.equal(cap.getOut(), 'rcf-lite 0.13.0\n');
  assert.equal(fetchCalled, false);
});

test('rcf version --check with a newer release prints headlines and exits 0', async () => {
  const s = await serveOnce({ body: JSON.stringify(feedNewerAvailable) });
  const { cacheDir, configDir } = await tempDirs();
  try {
    const cap = captureStreams();
    const code = await versionMain(['--check'], {
      ...cap,
      installedVersion: '0.13.0',
      feedUrl: s.url,
      cacheDir,
      configDir,
      env: {},
    });
    assert.equal(code, 0);
    const out = cap.getOut();
    assert.match(out, /rcf-lite 0\.13\.0/);
    assert.match(out, /An update is available: 0\.14\.0/);
    assert.match(out, /Coverage rollup/);
    assert.match(out, /rerun 'rcf init'/);
    assert.match(out, /2 releases newer/);
  } finally {
    await s.close();
  }
});

test('rcf version --check on the up-to-date feed prints "Up to date." exits 0', async () => {
  const s = await serveOnce({ body: JSON.stringify(feedUpToDate) });
  const { cacheDir, configDir } = await tempDirs();
  try {
    const cap = captureStreams();
    const code = await versionMain(['--check'], {
      ...cap,
      installedVersion: '0.13.0',
      feedUrl: s.url,
      cacheDir,
      configDir,
      env: {},
    });
    assert.equal(code, 0);
    assert.match(cap.getOut(), /Up to date\./);
  } finally {
    await s.close();
  }
});

test('rcf version --check against a placeholder feed reads as "no update information available"', async () => {
  const s = await serveOnce({ body: JSON.stringify(feedPlaceholder) });
  const { cacheDir, configDir } = await tempDirs();
  try {
    const cap = captureStreams();
    const code = await versionMain(['--check'], {
      ...cap,
      installedVersion: '0.13.0',
      feedUrl: s.url,
      cacheDir,
      configDir,
      env: {},
    });
    assert.equal(code, 0);
    const out = cap.getOut();
    assert.match(out, /rcf-lite 0\.13\.0/);
    assert.match(out, /No update information available\./);
    assert.doesNotMatch(out, /An update is available/);
    assert.equal(cap.getErr(), '');
  } finally {
    await s.close();
  }
});

test('rcf version --check with malformed JSON degrades to unknown with a stderr note (exit 3, no cache)', async () => {
  const s = await serveOnce({ body: '{not json' });
  const { cacheDir, configDir } = await tempDirs();
  try {
    const cap = captureStreams();
    const code = await versionMain(['--check'], {
      ...cap,
      installedVersion: '0.13.0',
      feedUrl: s.url,
      cacheDir,
      configDir,
      env: {},
    });
    assert.equal(code, 3);
    assert.match(cap.getOut(), /rcf-lite 0\.13\.0/);
    assert.match(cap.getErr(), /update check skipped: network unavailable/);
  } finally {
    await s.close();
  }
});

test('rcf version --check on timeout with no cache exits 3', async () => {
  const s = await serveOnce({ body: '{}', hangMs: 5_000 });
  const { cacheDir, configDir } = await tempDirs();
  try {
    const cap = captureStreams();
    const code = await versionMain(['--check'], {
      ...cap,
      installedVersion: '0.13.0',
      feedUrl: s.url,
      cacheDir,
      configDir,
      env: {},
      timeoutMs: 150,
    });
    assert.equal(code, 3);
    assert.match(cap.getErr(), /network unavailable/);
  } finally {
    await s.close();
  }
});

test('rcf version --check on non-200 response exits 3', async () => {
  const s = await serveOnce({ status: 502, body: 'boom' });
  const { cacheDir, configDir } = await tempDirs();
  try {
    const cap = captureStreams();
    const code = await versionMain(['--check'], {
      ...cap,
      installedVersion: '0.13.0',
      feedUrl: s.url,
      cacheDir,
      configDir,
      env: {},
    });
    assert.equal(code, 3);
  } finally {
    await s.close();
  }
});

test('rcf version --check writes a cache stamp on success', async () => {
  const s = await serveOnce({ body: JSON.stringify(feedNewerAvailable) });
  const { cacheDir, configDir } = await tempDirs();
  try {
    const cap = captureStreams();
    await versionMain(['--check', '--json'], {
      ...cap,
      installedVersion: '0.13.0',
      feedUrl: s.url,
      cacheDir,
      configDir,
      env: {},
    });
    const raw = await readFile(join(cacheDir, 'version-check.json'), 'utf8');
    const parsed = JSON.parse(raw);
    assert.equal(parsed.feedUrl, s.url);
    assert.equal(parsed.feed.latest, '0.14.0');
    assert.ok(typeof parsed.fetchedAt === 'string');
  } finally {
    await s.close();
  }
});

test('rcf version --check reuses a fresh cache and skips the network', async () => {
  const { cacheDir, configDir } = await tempDirs();
  // Pre-seed a fresh cache stamp.
  const fetchedAt = new Date().toISOString();
  await writeFile(
    join(cacheDir, 'version-check.json'),
    JSON.stringify({ fetchedAt, feedUrl: 'unused', feed: feedNewerAvailable }, null, 2),
    'utf8',
  );
  let fetchCalled = false;
  const cap = captureStreams();
  const code = await versionMain(['--check', '--json'], {
    ...cap,
    installedVersion: '0.13.0',
    feedUrl: 'http://127.0.0.1:1/does-not-matter',
    cacheDir,
    configDir,
    env: {},
    fetch: async () => { fetchCalled = true; return null; },
  });
  assert.equal(code, 0);
  assert.equal(fetchCalled, false);
  const envelope = JSON.parse(cap.getOut());
  assert.equal(envelope.feedSource, 'cache');
  assert.equal(envelope.status, 'behind');
});

test('rcf version --check refetches when the cache is stale (>6h)', async () => {
  const s = await serveOnce({ body: JSON.stringify(feedUpToDate) });
  const { cacheDir, configDir } = await tempDirs();
  try {
    // Stamp older than 6h.
    const oldStamp = new Date(Date.now() - 7 * 60 * 60 * 1_000).toISOString();
    await writeFile(
      join(cacheDir, 'version-check.json'),
      JSON.stringify({ fetchedAt: oldStamp, feedUrl: s.url, feed: feedNewerAvailable }),
      'utf8',
    );
    const cap = captureStreams();
    const code = await versionMain(['--check', '--json'], {
      ...cap,
      installedVersion: '0.13.0',
      feedUrl: s.url,
      cacheDir,
      configDir,
      env: {},
    });
    assert.equal(code, 0);
    const envelope = JSON.parse(cap.getOut());
    assert.equal(envelope.feedSource, 'network');
    // Should now reflect the up-to-date feed served by the server.
    assert.equal(envelope.status, 'current');
  } finally {
    await s.close();
  }
});

test('rcf version --check --no-cache always fetches, even with a fresh cache', async () => {
  const s = await serveOnce({ body: JSON.stringify(feedUpToDate) });
  const { cacheDir, configDir } = await tempDirs();
  try {
    const fetchedAt = new Date().toISOString();
    await writeFile(
      join(cacheDir, 'version-check.json'),
      JSON.stringify({ fetchedAt, feedUrl: s.url, feed: feedNewerAvailable }),
      'utf8',
    );
    const cap = captureStreams();
    const code = await versionMain(['--check', '--no-cache', '--json'], {
      ...cap,
      installedVersion: '0.13.0',
      feedUrl: s.url,
      cacheDir,
      configDir,
      env: {},
    });
    assert.equal(code, 0);
    const envelope = JSON.parse(cap.getOut());
    assert.equal(envelope.feedSource, 'network');
  } finally {
    await s.close();
  }
});

test('rcf version --check falls back to stale cache when the network fails', async () => {
  const { cacheDir, configDir } = await tempDirs();
  // Stamp older than 6h (stale) but younger than 24h (usable).
  const staleStamp = new Date(Date.now() - 10 * 60 * 60 * 1_000).toISOString();
  await writeFile(
    join(cacheDir, 'version-check.json'),
    JSON.stringify({ fetchedAt: staleStamp, feedUrl: 'x', feed: feedNewerAvailable }),
    'utf8',
  );
  const cap = captureStreams();
  const code = await versionMain(['--check', '--json'], {
    ...cap,
    installedVersion: '0.13.0',
    feedUrl: 'http://127.0.0.1:1/gone',
    cacheDir,
    configDir,
    env: {},
    fetch: async () => null, // simulate network failure
  });
  assert.equal(code, 0);
  const envelope = JSON.parse(cap.getOut());
  assert.equal(envelope.feedSource, 'cache');
  assert.match(cap.getErr(), /using cached feed/);
});

test('rcf version --check honours RCF_UPDATE_CHECK=off before any network call', async () => {
  const { cacheDir, configDir } = await tempDirs();
  let fetchCalled = false;
  const cap = captureStreams();
  const code = await versionMain(['--check'], {
    ...cap,
    installedVersion: '0.13.0',
    feedUrl: 'http://127.0.0.1:1/gone',
    cacheDir,
    configDir,
    env: { RCF_UPDATE_CHECK: 'off' },
    fetch: async () => { fetchCalled = true; return null; },
  });
  assert.equal(code, 0);
  assert.equal(fetchCalled, false);
  assert.match(cap.getErr(), /kill-switch is on/);
});

test('rcf version --check honours the config-file kill-switch', async () => {
  const { cacheDir, configDir } = await tempDirs();
  await writeFile(join(configDir, 'config.json'), JSON.stringify({ updateCheck: 'off' }), 'utf8');
  let fetchCalled = false;
  const cap = captureStreams();
  const code = await versionMain(['--check'], {
    ...cap,
    installedVersion: '0.13.0',
    feedUrl: 'http://127.0.0.1:1/gone',
    cacheDir,
    configDir,
    env: {},
    fetch: async () => { fetchCalled = true; return null; },
  });
  assert.equal(code, 0);
  assert.equal(fetchCalled, false);
});

test('rcf version --check discards a corrupted cache silently', async () => {
  const s = await serveOnce({ body: JSON.stringify(feedUpToDate) });
  const { cacheDir, configDir } = await tempDirs();
  try {
    await writeFile(join(cacheDir, 'version-check.json'), '{not json', 'utf8');
    const cap = captureStreams();
    const code = await versionMain(['--check', '--json'], {
      ...cap,
      installedVersion: '0.13.0',
      feedUrl: s.url,
      cacheDir,
      configDir,
      env: {},
    });
    assert.equal(code, 0);
    const envelope = JSON.parse(cap.getOut());
    assert.equal(envelope.feedSource, 'network');
  } finally {
    await s.close();
  }
});

test('rcf version rejects unknown flags with exit 2', async () => {
  const cap = captureStreams();
  const code = await versionMain(['--bogus'], { ...cap, installedVersion: '0.13.0' });
  assert.equal(code, 2);
  assert.match(cap.getErr(), /\[error\] usage/);
});

// ---------------------------------------------------------------------------
// End-to-end via the real bin, exercising registration in bin/rcf.js.
// ---------------------------------------------------------------------------

test('the real bin: rcf version prints rcf-lite <package.version>', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'rcf-version-bin-'));
  const pkg = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  const { code, stdout } = await runBin(cwd, ['version']);
  assert.equal(code, 0);
  assert.equal(stdout.trim(), `rcf-lite ${pkg.version}`);
});

test('the real bin: rcf version --help prints the version help block', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'rcf-version-bin-'));
  const { code, stdout } = await runBin(cwd, ['version', '--help']);
  assert.equal(code, 0);
  assert.match(stdout, /Usage: rcf version/);
});

test('the real bin: rcf help version prints the version help block', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'rcf-version-bin-'));
  const { code, stdout } = await runBin(cwd, ['help', 'version']);
  assert.equal(code, 0);
  assert.match(stdout, /Usage: rcf version/);
});

test('the real bin: rcf help top-level lists the version verb under core', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'rcf-version-bin-'));
  const { code, stdout } = await runBin(cwd, ['help']);
  assert.equal(code, 0);
  assert.match(stdout, /version \[--check\]/);
});

test('the real bin: rcf version --check with kill-switch on skips the network', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'rcf-version-bin-'));
  const { code, stdout, stderr } = await runBin(cwd, ['version', '--check'], {
    RCF_UPDATE_CHECK: 'off',
  });
  assert.equal(code, 0);
  assert.match(stdout, /rcf-lite /);
  assert.match(stderr, /kill-switch is on/);
});

// ---------------------------------------------------------------------------
// formatHuman / formatJson smoke.
// ---------------------------------------------------------------------------

test('formatHuman renders single-release-ahead as a flat bullet list', () => {
  const r = compareInstalledToFeed('0.13.0', feedUpToDate, 'network', 'x');
  // Not actually behind here; test single-release behind by manual result:
  const behind = {
    installed: '0.13.0',
    latest: '0.14.0',
    status: 'behind',
    releasesAhead: [{
      version: '0.14.0', date: '2026-09-01', breaking: false,
      headlines: ['A single headline sentence.'], minAgentAction: null,
    }],
    feedFetchedAt: 'x',
    feedSource: 'network',
  };
  const out = formatHuman(behind);
  assert.match(out, /An update is available: 0\.14\.0 \(released 2026-09-01\)\./);
  assert.match(out, / {2}- A single headline sentence\./);
  assert.doesNotMatch(out, /releases newer than yours/);
});

test('formatHuman flags BREAKING when a release ahead is breaking', () => {
  const behind = {
    installed: '0.13.0',
    latest: '0.14.0',
    status: 'behind',
    releasesAhead: [{
      version: '0.14.0', date: '2026-09-01', breaking: true,
      headlines: ['A breaking change.'], minAgentAction: 'rewrite-shell-invocations',
    }],
    feedFetchedAt: 'x',
    feedSource: 'network',
  };
  const out = formatHuman(behind);
  assert.match(out, /BREAKING/);
  assert.match(out, /rewrite old CLI invocations/);
});

test('formatJson emits the spec-shaped envelope', () => {
  const r = compareInstalledToFeed('0.13.0', feedNewerAvailable, 'network', '2026-09-01T09:14:22Z');
  const out = formatJson(r);
  const parsed = JSON.parse(out);
  assert.equal(parsed.installed, '0.13.0');
  assert.equal(parsed.latest, '0.14.0');
  assert.equal(parsed.status, 'behind');
  assert.equal(parsed.feedSource, 'network');
  assert.ok(Array.isArray(parsed.releasesAhead));
});
