// A configurable gh adapter fake for slice-4 CLI tests. The
// RCF_FEEDBACK_GH_FAKE_CONFIG env var names a JSON file whose shape
// controls each call:
//
//   {
//     "onPath":       { "present": true }                         // default
//     "auth":         { "authed": true }                          // default
//     "labelList":    { "names": ["rcf-feedback", ...] }          // default six
//     "repoView":     { "visibility": "PUBLIC", "viewerPermission": "ADMIN", "hasIssuesEnabled": true }
//     "search":       [ { "matches": [] }, { "matches": [ { "number": 12, "url": "..." } ] }, { "error": "search-unavailable" } ]
//     "search_closed":{ "matches": [] }
//     "create":       [ { "url": "https://.../issues/1", "number": 1 }, { "error": "ratelimit" } ]
//     "comment":      [ { "url": "https://.../issues/12#issuecomment-99" } ]
//     "labelCreate":  { "ok": true }
//   }
//
// Every non-error result may be a single object or an array; when an
// array, each call consumes one entry in order (the last entry
// repeats). Call log is appended to RCF_FEEDBACK_GH_FAKE_LOG.
//
// The fake also asserts that its env argument on create/comment
// carries no synthesised TOKEN key (design 3.1 / AC-15901-2). The
// CLI does not pass env to the adapter; the fake just records what
// process.env keys are present.

import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import process from 'node:process';

function currentConfigPath() { return process.env.RCF_FEEDBACK_GH_FAKE_CONFIG; }
function currentLogPath() { return process.env.RCF_FEEDBACK_GH_FAKE_LOG; }

function loadConfig() {
  const p = currentConfigPath();
  if (!p || !existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return {}; }
}

function logCall(name, args, result) {
  const p = currentLogPath();
  if (!p) return;
  const scrubbed = { name, args: { ...args } };
  scrubbed.result = { ok: result?.ok, kind: result?.kind, value: result?.value };
  appendFileSync(p, `${JSON.stringify(scrubbed)}\n`);
}

// Counters keyed by (configPath, key) so a re-invocation with a new
// scenario file starts fresh without needing a fresh import.
const counters = new Map();

function pick(key, fallback) {
  const CONFIG = loadConfig();
  const v = CONFIG[key];
  if (v == null) return fallback;
  if (Array.isArray(v)) {
    const cKey = `${currentConfigPath()}::${key}`;
    const i = counters.get(cKey) ?? 0;
    counters.set(cKey, i + 1);
    return v[Math.min(i, v.length - 1)];
  }
  return v;
}

function toResult(row, kindOnError = 'unknown') {
  if (row && typeof row === 'object' && 'error' in row) {
    return { ok: false, kind: row.error, message: row.message ?? row.error };
  }
  return { ok: true, value: row };
}

const DEFAULT_LABELS = ['rcf-feedback', 'severity:blocker', 'severity:major', 'severity:minor', 'area:blueprint', 'area:core'];

export async function ghOnPath() {
  const r = pick('onPath', { present: true });
  const out = toResult(r);
  logCall('ghOnPath', {}, out);
  return out;
}

export async function ghAuthStatus(opts = {}) {
  const raw = pick('auth', { authed: true });
  const out = raw.authed
    ? { ok: true, value: { authed: true, host: opts.host ?? 'github.com' } }
    : { ok: false, kind: raw.kind ?? 'auth', message: raw.message ?? 'not logged in' };
  logCall('ghAuthStatus', opts, out);
  return out;
}

export async function ghLabelList(opts) {
  const raw = pick('labelList', { names: DEFAULT_LABELS });
  const out = toResult(raw);
  logCall('ghLabelList', opts, out);
  return out;
}

export async function ghRepoView(opts) {
  const raw = pick('repoView', { visibility: 'PUBLIC', viewerPermission: 'ADMIN', hasIssuesEnabled: true });
  const out = toResult(raw);
  logCall('ghRepoView', opts, out);
  return out;
}

export async function ghIssueSearch(opts) {
  // Two separate streams so open and closed are addressable.
  const key = opts.state === 'closed' ? 'search_closed' : 'search';
  const raw = pick(key, { matches: [] });
  const out = toResult(raw, 'search-unavailable');
  logCall('ghIssueSearch', opts, out);
  return out;
}

export async function ghIssueCreate(opts) {
  const raw = pick('create', { url: 'https://github.com/example/repo/issues/1', number: 1 });
  const out = toResult(raw);
  logCall('ghIssueCreate', {
    ...opts,
    // Design 3.1 / AC-15901-2: the tool must never read GH_TOKEN or
    // GITHUB_TOKEN. The child inherits the parent env, so a token
    // pre-existing on the caller is not a violation; the assertion
    // is that the CLI did not synthesise or mutate these keys. The
    // fake records the two specific keys so the test can prove the
    // CLI's own contract without CI-level env pollution.
    ghToken: process.env.GH_TOKEN ?? null,
    githubToken: process.env.GITHUB_TOKEN ?? null,
  }, out);
  return out;
}

export async function ghIssueComment(opts) {
  const raw = pick('comment', { url: 'https://github.com/example/repo/issues/1#issuecomment-1' });
  const out = toResult(raw);
  logCall('ghIssueComment', opts, out);
  return out;
}

export async function ghLabelCreate(opts) {
  const raw = pick('labelCreate', { name: opts.name });
  const out = toResult(raw);
  logCall('ghLabelCreate', opts, out);
  return out;
}
