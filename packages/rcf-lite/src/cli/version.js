// `rcf version` core verb (update-awareness spec §2).
//
// Two shapes:
//   - `rcf version` -- print `rcf-lite <semver>` to stdout, no network.
//   - `rcf version --check` -- fetch the release feed, semver-compare
//     against the installed version, print a compact headline diff.
//
// Design invariants (spec §2):
//   - Zero telemetry. The fetch is a bare HTTPS GET; no identifiers, no
//     custom headers beyond a plain UA, no query params.
//   - Fail silent. Network failure, non-2xx, malformed JSON, unknown
//     feedVersion -- every failure mode degrades to "installed version
//     + one stderr line" and never blocks. Exit 3 only when --check has
//     no usable cache to fall back on.
//   - Cache-first. A 6-hour cache stamp keeps session-start checks off
//     the network on a healthy install; a 24-hour hard ceiling caps the
//     stale-cache window when the network drops.
//   - Kill-switch honoured before any network call: `RCF_UPDATE_CHECK=off`
//     env var OR `updateCheck: "off"` in the platform config file.
//   - Placeholder feed (latest: null, empty releases) reads as "no
//     update information available", NOT as an update, NOT as an error.
//
// Semver comparison is inline (three numeric segments + optional
// prerelease suffix per SemVer 2.0.0 §11); rcf-lite ships no runtime
// deps beyond ajv today and this verb should not add one.

import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, platform } from 'node:os';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(here, '..', '..');

// Feed URL is a compile-time constant so the tool has one truth. Tests
// override via the `feedUrl` dep.
export const FEED_URL = 'https://stravica.ai/docs/rcf/releases.json';

// Two-second budget on the network GET (spec §2.5).
export const FETCH_TIMEOUT_MS = 2_000;

// Six-hour cache window before a fresh fetch is attempted (spec §2.6).
export const CACHE_FRESH_MS = 6 * 60 * 60 * 1_000;

// 24-hour ceiling on stale-cache reuse when the network is down.
export const CACHE_STALE_CEILING_MS = 24 * 60 * 60 * 1_000;

// Highest feedVersion this CLI understands. A higher value is treated
// as "unknown" so an older CLI reading a newer feed degrades cleanly.
export const KNOWN_FEED_VERSION = 1;

// Kill-switch env var.
export const KILL_SWITCH_ENV = 'RCF_UPDATE_CHECK';

// minAgentAction hints the CLI knows how to describe. Unknown values
// are treated as null per spec §1.5 (forward-compat).
const KNOWN_MIN_AGENT_ACTIONS = {
  'rewrite-shell-invocations': 'rewrite old CLI invocations across the repo after upgrade.',
  'rerun-init': 'rerun \'rcf init\' after upgrade to refresh managed blocks.',
  'regenerate-chain': 'revalidate and refit existing chain documents after upgrade.',
  'schema-migration': 'the rcf-schemas dependency bumped; see release notes for migration guidance.',
};

const OPTION_SPEC = {
  check: { type: 'boolean' },
  json: { type: 'boolean' },
  'no-cache': { type: 'boolean' },
  help: { type: 'boolean' },
};

export const HELP = `Usage: rcf version [--check] [--json] [--no-cache] [--help]

Print the installed rcf-lite version. With --check, also fetch the
release feed at ${FEED_URL} and compare against the installed version.

The check is advisory: exit code is 0 whether you are up to date or
behind. Network trouble degrades to a stderr note and the installed
version, without blocking.

Options:
  --check                   Fetch the release feed and compare against
                            the installed version. Prints a compact
                            headline diff for each newer release.
  --json                    Machine-readable envelope. Fields:
                              installed, latest, status
                              (current | behind | ahead | unknown),
                              releasesAhead[], feedFetchedAt, feedSource
                              (network | cache | none).
  --no-cache                Bypass the local 6-hour cache stamp and force
                            a fresh fetch. Diagnostic path.
  --help                    Print this help.

Kill-switch:
  Set ${KILL_SWITCH_ENV}=off in the environment, or add
  { "updateCheck": "off" } to the platform config file
  (~/.config/rcf-lite/config.json on Linux, or the OS-appropriate
  config path). The check is skipped; the installed version is
  still printed.

Exit codes:
  0  version printed; freshness state (if requested) in output.
  2  usage error (unknown flag or positional arg).
  3  --check requested but the feed was unreachable AND no usable
     cache entry existed to fall back on.
`;

// ---------------------------------------------------------------------------
// Semver primitives (numeric x.y.z + optional prerelease; SemVer 2.0.0).
// ---------------------------------------------------------------------------

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

/**
 * Parse a semver string into `{ major, minor, patch, prerelease }` or
 * return `null` if it is not a well-formed semver.
 *
 * @param {string} v
 * @returns {null | { major: number, minor: number, patch: number, prerelease: string[] }}
 */
export function parseSemver(v) {
  if (typeof v !== 'string') return null;
  const m = SEMVER_RE.exec(v);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ? m[4].split('.') : [],
  };
}

/**
 * Compare two semvers. Returns -1 if a < b, 0 if equal, 1 if a > b.
 * Follows SemVer 2.0.0 §11: prerelease identifiers rank below the
 * matching normal version; numeric identifiers sort numerically,
 * alphanumeric lexically, numeric below alphanumeric.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) {
    // Non-semver values sort by plain string, as a last resort.
    if (a === b) return 0;
    return a < b ? -1 : 1;
  }
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;
  // Prerelease compare: no prerelease > any prerelease.
  if (pa.prerelease.length === 0 && pb.prerelease.length === 0) return 0;
  if (pa.prerelease.length === 0) return 1;
  if (pb.prerelease.length === 0) return -1;
  const len = Math.max(pa.prerelease.length, pb.prerelease.length);
  for (let i = 0; i < len; i++) {
    const ai = pa.prerelease[i];
    const bi = pb.prerelease[i];
    if (ai === undefined) return -1;
    if (bi === undefined) return 1;
    const an = /^\d+$/.test(ai);
    const bn = /^\d+$/.test(bi);
    if (an && bn) {
      const av = Number(ai);
      const bv = Number(bi);
      if (av !== bv) return av < bv ? -1 : 1;
    } else if (an) {
      return -1; // numeric < alphanumeric
    } else if (bn) {
      return 1;
    } else if (ai !== bi) {
      return ai < bi ? -1 : 1;
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Feed shape validation.
// ---------------------------------------------------------------------------

/**
 * Return true if `feed` matches the shape from spec §1.1 well enough
 * that the CLI can trust its keys. Missing optional fields are fine;
 * type mismatches on required fields are not.
 *
 * @param {unknown} feed
 * @returns {feed is FeedShape}
 */
export function isValidFeed(feed) {
  if (!feed || typeof feed !== 'object') return false;
  const f = /** @type {Record<string, unknown>} */ (feed);
  if (typeof f.feedVersion !== 'number') return false;
  if (typeof f.generated !== 'string') return false;
  // `latest` is a semver string OR null (placeholder feed).
  if (!(f.latest === null || typeof f.latest === 'string')) return false;
  if (!Array.isArray(f.releases)) return false;
  for (const r of f.releases) {
    if (!r || typeof r !== 'object') return false;
    const rr = /** @type {Record<string, unknown>} */ (r);
    if (typeof rr.version !== 'string') return false;
    if (typeof rr.date !== 'string') return false;
    if (typeof rr.breaking !== 'boolean') return false;
    if (!Array.isArray(rr.headlines)) return false;
    // headlines items must be strings.
    for (const h of rr.headlines) if (typeof h !== 'string') return false;
    // minAgentAction is string-or-null (required, per spec §1.1 table).
    if (!(rr.minAgentAction === null || typeof rr.minAgentAction === 'string')) return false;
  }
  return true;
}

/**
 * Predicate for "usable" feed. A feedVersion higher than the CLI knows
 * is discarded per spec §6 (forward-compat guard); every other shape
 * failure is discarded too.
 *
 * @param {unknown} feed
 * @returns {boolean}
 */
export function isUsableFeed(feed) {
  if (!isValidFeed(feed)) return false;
  if (feed.feedVersion > KNOWN_FEED_VERSION) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Cache and config paths.
// ---------------------------------------------------------------------------

/**
 * Resolve the platform-appropriate cache directory for rcf-lite state.
 * XDG on Linux with fallback to `~/.cache`; `~/Library/Caches` on macOS;
 * `%LOCALAPPDATA%` on Windows.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
export function resolveCacheDir(env = process.env) {
  const home = env.HOME ?? homedir();
  if (platform() === 'darwin') {
    return join(home, 'Library', 'Caches', 'rcf-lite');
  }
  if (platform() === 'win32') {
    const appData = env.LOCALAPPDATA;
    if (appData) return join(appData, 'rcf-lite', 'Cache');
    return join(home, 'AppData', 'Local', 'rcf-lite', 'Cache');
  }
  // Linux / other POSIX.
  const xdg = env.XDG_CACHE_HOME;
  if (xdg && xdg.length > 0) return join(xdg, 'rcf-lite');
  return join(home, '.cache', 'rcf-lite');
}

/**
 * Resolve the platform-appropriate config directory for rcf-lite state.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
export function resolveConfigDir(env = process.env) {
  const home = env.HOME ?? homedir();
  if (platform() === 'darwin') {
    return join(home, 'Library', 'Application Support', 'rcf-lite');
  }
  if (platform() === 'win32') {
    const appData = env.APPDATA;
    if (appData) return join(appData, 'rcf-lite');
    return join(home, 'AppData', 'Roaming', 'rcf-lite');
  }
  const xdg = env.XDG_CONFIG_HOME;
  if (xdg && xdg.length > 0) return join(xdg, 'rcf-lite');
  return join(home, '.config', 'rcf-lite');
}

/**
 * Read the platform config file (spec §2.6). Missing file is fine;
 * a corrupted file is treated as absent.
 *
 * @param {string} configDir
 * @returns {Promise<Record<string, unknown>>}
 */
export async function readConfig(configDir) {
  try {
    const raw = await readFile(join(configDir, 'config.json'), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
    return {};
  } catch {
    return {};
  }
}

/**
 * True if the kill-switch is engaged. Env var wins over config file
 * (either enough).
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {Record<string, unknown>} config
 * @returns {boolean}
 */
export function isKillSwitchOn(env, config) {
  if (env[KILL_SWITCH_ENV] === 'off') return true;
  if (config.updateCheck === 'off') return true;
  return false;
}

// ---------------------------------------------------------------------------
// Cache I/O.
// ---------------------------------------------------------------------------

/**
 * @typedef {object} CacheEntry
 * @property {string} fetchedAt
 * @property {string} feedUrl
 * @property {object} feed
 */

/**
 * Read the cache file if it exists and validates cleanly. Corrupted or
 * shape-invalid entries are discarded silently (spec §2.8).
 *
 * @param {string} cachePath
 * @returns {Promise<CacheEntry | null>}
 */
export async function readCache(cachePath) {
  try {
    const raw = await readFile(cachePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.fetchedAt !== 'string') return null;
    if (typeof parsed.feedUrl !== 'string') return null;
    if (!isUsableFeed(parsed.feed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Write the cache. Failures are swallowed silently (spec §6:
 * malformed cache dir permissions are non-fatal).
 *
 * @param {string} cachePath
 * @param {CacheEntry} entry
 * @returns {Promise<void>}
 */
export async function writeCache(cachePath, entry) {
  try {
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(cachePath, JSON.stringify(entry, null, 2), 'utf8');
  } catch {
    // Non-fatal.
  }
}

// ---------------------------------------------------------------------------
// Fetch primitive.
// ---------------------------------------------------------------------------

/**
 * Fetch the feed with a hard timeout. Returns the parsed feed or null
 * on any failure (network, non-2xx, malformed JSON, unknown
 * feedVersion). Never throws.
 *
 * @param {string} url
 * @param {object} deps
 * @param {typeof fetch} [deps.fetch]
 * @param {number} [deps.timeoutMs]
 * @returns {Promise<null | object>}
 */
export async function fetchFeed(url, deps = {}) {
  const doFetch = deps.fetch ?? globalThis.fetch;
  const timeoutMs = deps.timeoutMs ?? FETCH_TIMEOUT_MS;
  if (typeof doFetch !== 'function') return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await doFetch(url, { signal: ctrl.signal });
    if (!res || !res.ok) return null;
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { return null; }
    if (!isUsableFeed(parsed)) return null;
    return parsed;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Compare + result envelope.
// ---------------------------------------------------------------------------

/**
 * @typedef {object} CheckResult
 * @property {string} installed
 * @property {string | null} latest
 * @property {'current' | 'behind' | 'ahead' | 'unknown'} status
 * @property {Array<object>} releasesAhead
 * @property {string | null} feedFetchedAt
 * @property {'network' | 'cache' | 'none'} feedSource
 */

/**
 * Compute the check envelope from an installed version + a feed (or
 * null feed = unknown state).
 *
 * @param {string} installed
 * @param {object | null} feed
 * @param {'network' | 'cache' | 'none'} feedSource
 * @param {string | null} feedFetchedAt
 * @returns {CheckResult}
 */
export function compareInstalledToFeed(installed, feed, feedSource, feedFetchedAt) {
  if (!feed || feed.latest === null || !Array.isArray(feed.releases) || feed.releases.length === 0) {
    // No update information available (placeholder feed or empty).
    return {
      installed,
      latest: null,
      status: 'unknown',
      releasesAhead: [],
      feedFetchedAt,
      feedSource,
    };
  }
  // Sort releases by semver descending; the feed asserts newest-first
  // but do not trust it (spec §2.7 downgrade protection: semver wins
  // over date ordering).
  const sortedNewestFirst = [...feed.releases].sort((a, b) => compareSemver(b.version, a.version));
  const latest = sortedNewestFirst[0].version;
  const cmp = compareSemver(installed, latest);
  if (cmp === 0) {
    return { installed, latest, status: 'current', releasesAhead: [], feedFetchedAt, feedSource };
  }
  if (cmp > 0) {
    return { installed, latest, status: 'ahead', releasesAhead: [], feedFetchedAt, feedSource };
  }
  // Behind: collect every release with version > installed, newest first.
  const releasesAhead = sortedNewestFirst.filter((r) => compareSemver(r.version, installed) > 0);
  return { installed, latest, status: 'behind', releasesAhead, feedFetchedAt, feedSource };
}

// ---------------------------------------------------------------------------
// Output formatting.
// ---------------------------------------------------------------------------

/**
 * Render the human-readable check output. Deliberately terse; multi-
 * release ahead cases group headlines under version headers.
 *
 * @param {CheckResult} result
 * @returns {string}
 */
export function formatHuman(result) {
  const head = `rcf-lite ${result.installed}\n`;
  if (result.status === 'current') {
    return `${head}Up to date.\n`;
  }
  if (result.status === 'ahead') {
    return `${head}Installed version is ahead of the release feed. No upgrade proposed.\n`;
  }
  if (result.status === 'unknown') {
    return `${head}No update information available.\n`;
  }
  // behind.
  const [top, ...rest] = result.releasesAhead;
  const breaking = top.breaking ? ' BREAKING.' : '';
  const countNote = result.releasesAhead.length > 1
    ? ` ${result.releasesAhead.length} releases newer than yours.`
    : '';
  const lines = [head.trimEnd(), ''];
  lines.push(`An update is available: ${top.version} (released ${top.date}).${breaking}${countNote}`);
  if (result.releasesAhead.length === 1) {
    for (const h of top.headlines) lines.push(`  - ${h}`);
  } else {
    for (const r of result.releasesAhead) {
      lines.push(`  ${r.version}`);
      for (const h of r.headlines) lines.push(`    - ${h}`);
    }
  }
  const migrationHints = collectMigrationHints(result.releasesAhead);
  if (migrationHints.length > 0) {
    lines.push('');
    for (const hint of migrationHints) lines.push(`Migration hint: ${hint}`);
  }
  const notesUrl = top.notesUrl;
  if (notesUrl) {
    lines.push('');
    lines.push(`Release notes: ${notesUrl}`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Collect distinct migration-hint sentences for every release ahead
 * whose minAgentAction is in the known vocabulary. Preserves
 * newest-first order.
 *
 * @param {Array<object>} releasesAhead
 * @returns {string[]}
 */
function collectMigrationHints(releasesAhead) {
  const seen = new Set();
  const out = [];
  for (const r of releasesAhead) {
    const action = r.minAgentAction;
    if (!action || typeof action !== 'string') continue;
    const hint = KNOWN_MIN_AGENT_ACTIONS[action];
    if (!hint) continue; // unknown values treated as null (spec §1.5)
    if (seen.has(hint)) continue;
    seen.add(hint);
    out.push(hint);
  }
  return out;
}

/**
 * Render the JSON envelope. Shape matches spec §2.3.
 *
 * @param {CheckResult} result
 * @returns {string}
 */
export function formatJson(result) {
  return `${JSON.stringify(result, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Package-version reader.
// ---------------------------------------------------------------------------

async function readInstalledVersion() {
  try {
    const pkg = JSON.parse(await readFile(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

// ---------------------------------------------------------------------------
// Dispatch.
// ---------------------------------------------------------------------------

/**
 * `rcf version` handler.
 *
 * Deps hooks (all optional; defaults from process):
 *   - stdout / stderr: writable streams.
 *   - env: process.env-shaped map.
 *   - now: () => Date (for cache-freshness reasoning).
 *   - fetch: fetch impl (for test doubles).
 *   - feedUrl: override the compile-time URL.
 *   - cacheDir / configDir: absolute directory overrides.
 *   - installedVersion: string override (skip reading package.json).
 *   - timeoutMs: override the fetch timeout (default 2s).
 *
 * @param {string[]} argv
 * @param {object} [deps]
 * @returns {Promise<number>}
 */
export async function main(argv, deps = {}) {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());

  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: OPTION_SPEC,
      allowPositionals: false,
      strict: true,
    });
  } catch (err) {
    stderr.write(`[error] usage ${err.message}\n`);
    stderr.write(HELP);
    return 2;
  }
  if (parsed.values.help) {
    stdout.write(HELP);
    return 0;
  }

  const installed = deps.installedVersion ?? await readInstalledVersion();

  // Bare `rcf version` -- no network, no cache, no side effects.
  if (!parsed.values.check) {
    stdout.write(`rcf-lite ${installed}\n`);
    return 0;
  }

  // --check path.
  const feedUrl = deps.feedUrl ?? FEED_URL;
  const cacheDir = deps.cacheDir ?? resolveCacheDir(env);
  const configDir = deps.configDir ?? resolveConfigDir(env);
  const cachePath = join(cacheDir, 'version-check.json');

  // Kill-switch is honoured before any cache read or network call.
  const config = await readConfig(configDir);
  if (isKillSwitchOn(env, config)) {
    stdout.write(`rcf-lite ${installed}\n`);
    stderr.write('update check skipped: kill-switch is on.\n');
    return 0;
  }

  const t0 = now();
  const existingCache = await readCache(cachePath);
  const cacheIsFresh = existingCache
    ? (t0.getTime() - Date.parse(existingCache.fetchedAt)) < CACHE_FRESH_MS
    : false;
  const cacheIsUsable = existingCache
    ? (t0.getTime() - Date.parse(existingCache.fetchedAt)) < CACHE_STALE_CEILING_MS
    : false;

  const forceNetwork = Boolean(parsed.values['no-cache']);

  /** @type {object | null} */
  let feed = null;
  /** @type {'network' | 'cache' | 'none'} */
  let feedSource = 'none';
  /** @type {string | null} */
  let feedFetchedAt = null;

  if (cacheIsFresh && !forceNetwork && existingCache) {
    feed = existingCache.feed;
    feedSource = 'cache';
    feedFetchedAt = existingCache.fetchedAt;
  } else {
    // Attempt a network fetch.
    const fresh = await fetchFeed(feedUrl, {
      fetch: deps.fetch,
      timeoutMs: deps.timeoutMs ?? FETCH_TIMEOUT_MS,
    });
    if (fresh) {
      feed = fresh;
      feedSource = 'network';
      feedFetchedAt = now().toISOString();
      await writeCache(cachePath, { fetchedAt: feedFetchedAt, feedUrl, feed });
    } else if (cacheIsUsable && existingCache) {
      feed = existingCache.feed;
      feedSource = 'cache';
      feedFetchedAt = existingCache.fetchedAt;
      stderr.write('update check: network fetch failed; using cached feed.\n');
    } else {
      feed = null;
      feedSource = 'none';
      feedFetchedAt = null;
      stderr.write('update check skipped: network unavailable.\n');
    }
  }

  const result = compareInstalledToFeed(installed, feed, feedSource, feedFetchedAt);

  if (parsed.values.json) {
    stdout.write(formatJson(result));
  } else {
    stdout.write(formatHuman(result));
  }

  // Exit 3 only when --check was requested and no signal at all was
  // available (no network AND no usable cache). Being behind is not a
  // failure exit; that would tempt CI to gate on freshness (spec §2.4).
  if (feedSource === 'none') return 3;
  return 0;
}
