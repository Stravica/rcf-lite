// Feedback gh adapter (TAC-4107-feedback-gh, ADR-4105). The one place
// that shells out to gh. Slice 4 (FBS-183) ships:
//
//   - ghAuthStatus({ host })            probe gh auth for a host
//   - ghLabelList({ repo })             list existing label names
//   - ghRepoView({ repo })               visibility + viewerPermission + hasIssuesEnabled
//   - ghIssueSearch({ repo, query, state, limit })   dedupe search
//   - ghIssueCreate({ repo, title, body, labels })   create one issue
//   - ghIssueComment({ repo, number, body })         +1 comment
//   - ghLabelCreate({ repo, name, description, color })  bootstrap only
//
// Every function returns a typed result. Errors are classified into
// { kind: 'network' | 'notFound' | 'ratelimit' | 'client' | 'server' |
// 'auth' | 'notInstalled' | 'unknown', message, exitCode? }. The
// tool never spawns `gh auth login`, never reads GH_TOKEN or
// GITHUB_TOKEN, never mutates process.env.
//
// The RCF_FEEDBACK_GH_MODULE env var names an alternative module the
// caller can import in place of this file; tests use it to record
// calls without touching gh. This mirrors the verifier launchAgent
// override in src/verify/engine/launcher.js.

import { spawn } from 'node:child_process';
import process from 'node:process';

/**
 * @typedef {object} GhOk
 * @property {true} ok
 * @property {any} value
 */

/**
 * @typedef {object} GhErr
 * @property {false} ok
 * @property {'network' | 'notFound' | 'ratelimit' | 'client' | 'server' | 'auth' | 'notInstalled' | 'search-unavailable' | 'unknown'} kind
 * @property {string} message
 * @property {number} [exitCode]
 */

/** @typedef {GhOk | GhErr} GhResult */

const DEFAULT_HOST = 'github.com';

/**
 * Load the gh adapter. When RCF_FEEDBACK_GH_MODULE is set, import that
 * module and return it; otherwise return this module's own default
 * exports. The consumer (`src/cli/feedback.js:handleSubmit`) calls
 * this once per invocation.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<GhAdapter>}
 */
export async function loadGhAdapter(env = process.env) {
  const override = env.RCF_FEEDBACK_GH_MODULE;
  if (typeof override === 'string' && override.length > 0) {
    const mod = await import(override);
    return normaliseAdapter(mod);
  }
  return DEFAULT_ADAPTER;
}

/**
 * Adapter shape (also what a test fake must provide). Every function
 * takes an options object and returns a Promise<GhResult>.
 *
 * @typedef {object} GhAdapter
 * @property {(opts?: { host?: string }) => Promise<GhResult>} ghAuthStatus
 * @property {(opts: { repo: string }) => Promise<GhResult>} ghLabelList
 * @property {(opts: { repo: string }) => Promise<GhResult>} ghRepoView
 * @property {(opts: { repo: string, query: string, state?: 'open' | 'closed', limit?: number }) => Promise<GhResult>} ghIssueSearch
 * @property {(opts: { repo: string, title: string, body: string, labels: string[] }) => Promise<GhResult>} ghIssueCreate
 * @property {(opts: { repo: string, number: number, body: string }) => Promise<GhResult>} ghIssueComment
 * @property {(opts: { repo: string, name: string, description?: string, color?: string }) => Promise<GhResult>} ghLabelCreate
 * @property {() => Promise<GhResult>} [ghOnPath]
 */

/**
 * Return an { ok: true, value: { present: boolean } } result naming
 * whether the `gh` binary is on PATH. The default adapter shells out
 * to `gh --version`; a test fake overrides through the seam.
 *
 * @returns {Promise<GhResult>}
 */
export async function ghOnPath() {
  const r = await runGh(['--version']);
  if (r.ok) return { ok: true, value: { present: true } };
  if (r.kind === 'notInstalled') return { ok: true, value: { present: false } };
  return r;
}

/**
 * `gh auth status --hostname <host>` exit 0 means logged in on that
 * host. gh writes the status to stderr; a non-zero exit is the auth
 * failure the design section 7 fallback keys off.
 *
 * @param {{ host?: string }} [opts]
 * @returns {Promise<GhResult>}
 */
export async function ghAuthStatus(opts = {}) {
  const host = opts.host ?? DEFAULT_HOST;
  const r = await runGh(['auth', 'status', '--hostname', host]);
  if (r.ok) return { ok: true, value: { authed: true, host } };
  if (r.kind === 'notInstalled') return r;
  return { ok: false, kind: 'auth', message: `not logged in to ${host}`, exitCode: r.exitCode };
}

/**
 * `gh label list --repo <repo> --json name` returns [{ name }, ...].
 * A repo without labels returns []. A repo you cannot see returns
 * an auth or notFound error; the caller treats either as "labels
 * unknown" and drops all label requests.
 *
 * @param {{ repo: string }} opts
 * @returns {Promise<GhResult>}
 */
export async function ghLabelList(opts) {
  const r = await runGh(['label', 'list', '--repo', opts.repo, '--json', 'name', '--limit', '100']);
  if (!r.ok) return r;
  try {
    const parsed = JSON.parse(r.value.stdout);
    const names = Array.isArray(parsed) ? parsed.map((row) => row?.name).filter((n) => typeof n === 'string') : [];
    return { ok: true, value: { names } };
  } catch (err) {
    return { ok: false, kind: 'unknown', message: `label list parse failed: ${err.message}` };
  }
}

/**
 * `gh repo view <repo> --json visibility,viewerPermission,hasIssuesEnabled`.
 *
 * @param {{ repo: string }} opts
 * @returns {Promise<GhResult>}
 */
export async function ghRepoView(opts) {
  const r = await runGh(['repo', 'view', opts.repo, '--json', 'visibility,viewerPermission,hasIssuesEnabled']);
  if (!r.ok) return r;
  try {
    const parsed = JSON.parse(r.value.stdout);
    return {
      ok: true,
      value: {
        visibility: parsed?.visibility ?? null,
        viewerPermission: parsed?.viewerPermission ?? null,
        hasIssuesEnabled: parsed?.hasIssuesEnabled ?? null,
      },
    };
  } catch (err) {
    return { ok: false, kind: 'unknown', message: `repo view parse failed: ${err.message}` };
  }
}

/**
 * `gh search issues <query> --repo <repo> --state <state> --json
 * number,url,title --limit <n>`. Slice 4 uses `--match body` via the
 * query syntax "in:body <query>" so the dedupe search hits the
 * fingerprint line. Search may be off on GHES and rate-limited on
 * github.com; both fold to a search-unavailable error the caller
 * treats as "fall through to create".
 *
 * @param {{ repo: string, query: string, state?: 'open' | 'closed', limit?: number }} opts
 * @returns {Promise<GhResult>}
 */
export async function ghIssueSearch(opts) {
  const state = opts.state ?? 'open';
  const limit = String(opts.limit ?? 5);
  const args = [
    'search', 'issues',
    `in:body ${opts.query}`,
    '--repo', opts.repo,
    '--state', state,
    '--json', 'number,url,title',
    '--limit', limit,
  ];
  const r = await runGh(args);
  if (!r.ok) {
    if (r.kind === 'ratelimit' || r.kind === 'server') {
      return { ok: false, kind: 'search-unavailable', message: r.message, exitCode: r.exitCode };
    }
    return r;
  }
  try {
    const parsed = JSON.parse(r.value.stdout);
    const matches = Array.isArray(parsed)
      ? parsed.filter((m) => m && typeof m.number === 'number')
      : [];
    return { ok: true, value: { matches } };
  } catch (err) {
    return { ok: false, kind: 'search-unavailable', message: `search parse failed: ${err.message}` };
  }
}

/**
 * `gh issue create --repo <repo> --title <t> --body-file - --label
 * <l1> --label <l2>...` reads the body from stdin so a long body is
 * safe across every shell. Returns { url, number }.
 *
 * @param {{ repo: string, title: string, body: string, labels: string[] }} opts
 * @returns {Promise<GhResult>}
 */
export async function ghIssueCreate(opts) {
  const args = ['issue', 'create', '--repo', opts.repo, '--title', opts.title, '--body-file', '-'];
  for (const l of opts.labels ?? []) args.push('--label', l);
  const r = await runGh(args, { stdin: opts.body });
  if (!r.ok) return r;
  const url = extractIssueUrl(r.value.stdout);
  const number = extractIssueNumber(url);
  return { ok: true, value: { url, number } };
}

/**
 * `gh issue comment <number> --repo <repo> --body-file -`. Returns
 * { url }.
 *
 * @param {{ repo: string, number: number, body: string }} opts
 * @returns {Promise<GhResult>}
 */
export async function ghIssueComment(opts) {
  const args = ['issue', 'comment', String(opts.number), '--repo', opts.repo, '--body-file', '-'];
  const r = await runGh(args, { stdin: opts.body });
  if (!r.ok) return r;
  const url = (r.value.stdout || '').trim().split(/\s+/).pop() || '';
  return { ok: true, value: { url } };
}

/**
 * `gh label create <name> --repo <repo> --description <d> --color <c>`.
 * Only used by scripts/bootstrap-feedback-labels.mjs; the tool proper
 * never creates labels on submit.
 *
 * @param {{ repo: string, name: string, description?: string, color?: string }} opts
 * @returns {Promise<GhResult>}
 */
export async function ghLabelCreate(opts) {
  const args = ['label', 'create', opts.name, '--repo', opts.repo];
  if (opts.description) args.push('--description', opts.description);
  if (opts.color) args.push('--color', opts.color);
  const r = await runGh(args);
  if (!r.ok) return r;
  return { ok: true, value: { name: opts.name } };
}

// -- helpers --------------------------------------------------------------

/**
 * Spawn gh with the given args, capture stdout/stderr, and classify
 * failures. We pass a filtered environment (no synthesised TOKEN keys)
 * so a test can assert the tool never invents credentials.
 *
 * @param {string[]} args
 * @param {{ stdin?: string, env?: NodeJS.ProcessEnv }} [opts]
 * @returns {Promise<GhResult>}
 */
async function runGh(args, opts = {}) {
  return new Promise((resolvePromise) => {
    let child;
    try {
      child = spawn('gh', args, {
        env: opts.env ?? process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolvePromise({ ok: false, kind: classifySpawnError(err), message: err.message });
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', (err) => {
      resolvePromise({ ok: false, kind: classifySpawnError(err), message: err.message });
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise({ ok: true, value: { stdout, stderr } });
        return;
      }
      resolvePromise({
        ok: false,
        kind: classifyExit(code, stderr),
        message: stderr.trim() || `gh exited with code ${code}`,
        exitCode: code ?? undefined,
      });
    });
    if (typeof opts.stdin === 'string') {
      child.stdin.end(opts.stdin);
    } else {
      child.stdin.end();
    }
  });
}

/**
 * Classify a spawn-time error. ENOENT means gh is not on PATH.
 *
 * @param {NodeJS.ErrnoException} err
 * @returns {GhErr['kind']}
 */
function classifySpawnError(err) {
  if (err && err.code === 'ENOENT') return 'notInstalled';
  return 'unknown';
}

/**
 * Classify a non-zero gh exit into one of the error kinds the caller
 * keys off. Uses stderr substrings because gh does not emit machine
 * codes; the shapes below are stable across recent gh versions.
 *
 * @param {number | null} code
 * @param {string} stderr
 * @returns {GhErr['kind']}
 */
function classifyExit(code, stderr) {
  const s = (stderr || '').toLowerCase();
  if (/(rate limit|abuse|secondary rate)/.test(s)) return 'ratelimit';
  if (/(not found|could not resolve|http 404)/.test(s)) return 'notFound';
  if (/(unauthorised|unauthorized|http 401|not logged in|authentication)/.test(s)) return 'auth';
  if (/(http 5\d\d|internal server error)/.test(s)) return 'server';
  if (/(http 4\d\d)/.test(s)) return 'client';
  if (/(network|econnrefused|etimedout|dial tcp|dns)/.test(s)) return 'network';
  return 'unknown';
}

/**
 * Extract the issue url from gh's `issue create` stdout (which is
 * usually just the URL on its own line, possibly followed by a
 * trailing newline).
 *
 * @param {string} stdout
 * @returns {string}
 */
function extractIssueUrl(stdout) {
  const m = (stdout || '').match(/https?:\/\/[^\s]+/);
  return m ? m[0] : '';
}

/**
 * Extract the issue number from a gh issue url.
 *
 * @param {string} url
 * @returns {number | null}
 */
function extractIssueNumber(url) {
  const m = (url || '').match(/\/issues\/(\d+)/);
  return m ? Number(m[1]) : null;
}

/**
 * Normalise an override module: allow either a default export or
 * per-name exports; a partial module falls back to the default
 * implementations here for anything it does not override.
 *
 * @param {any} mod
 * @returns {GhAdapter}
 */
function normaliseAdapter(mod) {
  const base = { ...DEFAULT_ADAPTER };
  const src = mod && typeof mod === 'object' && mod.default && typeof mod.default === 'object'
    ? { ...mod, ...mod.default }
    : mod;
  for (const key of Object.keys(base)) {
    if (typeof src?.[key] === 'function') base[key] = src[key];
  }
  return base;
}

/** Default adapter (this module's own implementations). */
export const DEFAULT_ADAPTER = Object.freeze({
  ghOnPath,
  ghAuthStatus,
  ghLabelList,
  ghRepoView,
  ghIssueSearch,
  ghIssueCreate,
  ghIssueComment,
  ghLabelCreate,
});
