// h2-cf-kv-real-account-shim.mjs
//
// Fixture-side self-provisioning shim for the KV
// real-account-eventual-consistency-smoke probe. Mints a scratch KV
// namespace under the documented H-2 throwaway prefix, exposes the
// put / get / delete helpers the probe drives against it, and tears
// the namespace down again. A separate crash-recovery entry point
// (sweepOrphans) lists namespaces by prefix and deletes each by
// exact name; the happy-path teardown never calls the sweep, and
// the sweep is structurally unable to select a non-prefixed name
// (Dave hard constraint 8be06ee5).
//
// Throwaway prefix (reused so the gate's orphan grep keeps working
// unchanged): "h2-cf-probe-integrity-scratch-kv-". Key prefix used
// inside the scratch namespace: "h2-storage-smoke-".
//
// Every mint returns the exact CF-assigned id and the exact title
// used at create; teardown asserts both against the record before
// firing the delete. The scratch record is persisted to
// scratch/last-kv-namespace.json so a mid-run crash still surfaces
// the id to a follow-up teardown call; the sweep does not depend on
// the scratch file - it lists over the account and filters by
// prefix.

import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  kvCreateNamespace, kvDeleteNamespace, kvListNamespaces,
  kvPut, kvGet, kvDelete,
} from './h2-cf-account-api.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRATCH_DIR = resolve(HERE, 'scratch');
const SCRATCH_PATH = join(SCRATCH_DIR, 'last-kv-namespace.json');

export const NAMESPACE_PREFIX = 'h2-cf-probe-integrity-scratch-kv-';
export const KEY_PREFIX = 'h2-storage-smoke-';

// Every env var the probe / shim can skip or fail on. Declared here
// so the probe body can copy this list verbatim into its report.extra
// (dispatch requirement 4).
export const DECLARED_ENV = Object.freeze([
  'CI_HAS_CLOUDFLARE_ACCOUNT',
  'CF_ACCOUNT_ID',
  'CF_API_TOKEN',
  'CF_API_BASE_URL',
]);

function assertPrefix(title, where) {
  if (typeof title !== 'string' || !title.startsWith(NAMESPACE_PREFIX)) {
    throw new Error(`${where}: refusing to act on namespace title ${JSON.stringify(title)} - prefix ${NAMESPACE_PREFIX} not present`);
  }
}

function assertKeyPrefix(key, where) {
  if (typeof key !== 'string' || !key.startsWith(KEY_PREFIX)) {
    throw new Error(`${where}: refusing to act on key ${JSON.stringify(key)} - prefix ${KEY_PREFIX} not present`);
  }
}

export function generateNamespaceTitle({ runId } = {}) {
  const rid = String(runId || process.env.GITHUB_RUN_ID || `local-${Date.now()}`);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${NAMESPACE_PREFIX}${rid}-${rand}`;
}

export function generateKey({ runId } = {}) {
  const rid = String(runId || process.env.GITHUB_RUN_ID || `local-${Date.now()}`);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${KEY_PREFIX}${rid}-${rand}`;
}

export async function mintScratchNamespace({ runId, title } = {}) {
  const chosenTitle = title || generateNamespaceTitle({ runId });
  assertPrefix(chosenTitle, 'mintScratchNamespace');
  const created = await kvCreateNamespace({ title: chosenTitle });
  // Sanity: the CF response's title MUST equal what we asked for; if
  // Cloudflare ever mutates it we would delete against the returned
  // name only, but the create title is what our sweep filters on.
  const record = {
    id: created.id,
    title: created.title,
    requestedTitle: chosenTitle,
    createdAt: new Date().toISOString(),
    runId: String(runId || process.env.GITHUB_RUN_ID || 'local'),
  };
  await mkdir(SCRATCH_DIR, { recursive: true });
  await writeFile(SCRATCH_PATH, JSON.stringify(record, null, 2) + '\n', 'utf8');
  return record;
}

export async function destroyScratchNamespace(record) {
  let target = record;
  if (!target) {
    try {
      target = JSON.parse(await readFile(SCRATCH_PATH, 'utf8'));
    } catch (err) {
      process.stderr.write(`h2-cf-kv shim: scratch file missing (${err.message}); teardown deferred to sweepOrphans.\n`);
      return { destroyed: null, reason: 'scratch-missing' };
    }
  }
  // Two independent guards (Dave hard constraint 3): target.id must
  // exist AND the title carries the throwaway prefix. Either failure
  // aborts the delete loudly rather than firing against the wrong
  // resource.
  if (!target.id) throw new Error('destroyScratchNamespace: record has no id');
  assertPrefix(target.title, 'destroyScratchNamespace');
  if (target.requestedTitle && target.requestedTitle !== target.title) {
    throw new Error(`destroyScratchNamespace: title drift (requested=${target.requestedTitle} observed=${target.title}); refusing to delete on ambiguous identity`);
  }
  // Third independent guard: fetch the current title from the account
  // and confirm it still carries the prefix (defence-in-depth against
  // an id being re-bound to a live namespace between mint and
  // teardown; the account's namespace list is authoritative on the
  // current name attached to an id).
  const live = await kvListNamespaces();
  const observed = live.find((n) => n.id === target.id);
  if (observed) {
    assertPrefix(observed.title, 'destroyScratchNamespace(live)');
  }
  const result = await kvDeleteNamespace({ id: target.id, title: target.title });
  try { await unlink(SCRATCH_PATH); } catch (_err) { /* fine */ }
  return { destroyed: target.id, title: target.title, api: result };
}

// Sweep: list every KV namespace, keep only those whose title carries
// the throwaway prefix, delete each by exact id + exact name. The
// filter is a startsWith on the FROZEN prefix constant; any name
// missing the prefix is unreachable from this code path (Dave hard
// constraint 4). No cutoff: we control the prefix, so a match is
// unambiguously ours.
// Pure selection function extracted from sweepOrphans so a safety
// test can feed a live account listing and assert the filter selects
// zero live-named resources without any delete path being exercised
// (Dave hard constraint 4; live-inventory variant of the sweep-safety
// test). No IO, no mutation.
export function selectSweepCandidates(listing) {
  if (!Array.isArray(listing)) return [];
  return listing.filter((n) => typeof n.title === 'string' && n.title.startsWith(NAMESPACE_PREFIX));
}

export async function sweepOrphans({ live } = {}) {
  const listing = Array.isArray(live) ? live : await kvListNamespaces();
  const candidates = selectSweepCandidates(listing);
  const swept = [];
  for (const n of candidates) {
    // Belt-and-braces: repeat the prefix assert on the sweep path so
    // any regression to a pattern-match (e.g. someone editing the
    // filter to a regex that also matches production names) still
    // trips the guard before the delete fires.
    assertPrefix(n.title, 'sweepOrphans');
    try {
      await kvDeleteNamespace({ id: n.id, title: n.title });
      swept.push({ id: n.id, title: n.title });
    } catch (err) {
      process.stderr.write(`sweepOrphans: delete namespace ${n.id} (${n.title}) failed: ${err.message}\n`);
    }
  }
  return { swept, sweptCount: swept.length, candidatesConsidered: candidates.length, totalListed: listing.length };
}

// ------ Probe-facing helpers (put / get / delete a scratch key inside
// the minted namespace) ------

export async function putScratchKey({ namespaceId, key, value }) {
  assertKeyPrefix(key, 'putScratchKey');
  return kvPut({ namespaceId, key, value });
}

export async function getScratchKey({ namespaceId, key }) {
  assertKeyPrefix(key, 'getScratchKey');
  return kvGet({ namespaceId, key });
}

export async function deleteScratchKey({ namespaceId, key }) {
  assertKeyPrefix(key, 'deleteScratchKey');
  return kvDelete({ namespaceId, key });
}

// Test-only convenience: return the scratch record path so a test can
// simulate a crash by deleting the file mid-run, or read the current
// record without going through the mint path.
export const _SCRATCH_PATH = SCRATCH_PATH;

// CLI entry: `node h2-cf-kv-real-account-shim.mjs sweep` runs the
// account-wide sweep. Never invoked by the probe; used by the nightly
// sweep-orphans job.
if (import.meta.url === `file://${process.argv[1]}`) {
  const verb = process.argv[2] || 'sweep';
  if (verb !== 'sweep') {
    process.stderr.write(`unknown verb ${verb}; only 'sweep' is supported on the CLI\n`);
    process.exit(2);
  }
  sweepOrphans().then((r) => {
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  }).catch((err) => {
    process.stderr.write(`sweep failed: ${err.stack || err.message}\n`);
    process.exit(1);
  });
}
