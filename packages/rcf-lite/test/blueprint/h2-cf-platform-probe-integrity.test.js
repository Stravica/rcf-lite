// Anatomy test for the `h2-cf-platform-probe-integrity` suite. Covers
// TS-184: SIMULATE_ purity across the four Cloudflare-platform blueprints
// (AC-15401-1), envelope hygiene under .rcf/reports (AC-15401-2), and
// probe-comment honesty (AC-15401-3).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..', '..', '..');
const BLUEPRINTS = [
  'platform-cloudflare-kv',
  'platform-cloudflare-durable-objects',
  'messaging-queue-cloudflare',
  'edge-cloudflare-tunnel',
];

async function probeFiles(bpSlug) {
  const dir = join(REPO_ROOT, 'blueprints', bpSlug, 'contributions', 'probes');
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.mjs'))
    .map((e) => join(dir, e.name));
}

// TS-184 / TC-184-simulate-purity-four-blueprints (AC-15401-1):
// SIMULATE_ purity: no probe body on the four Cloudflare-platform blueprints
// reads a mutation switch via `process.env.SIMULATE_*`. Mutation switches live
// on the fixture side (fixture shim / child consumer env) only. The literal
// SIMULATE_ token may appear in a probe body only as an env-name pass-through
// string handed to a fixture-side child consumer; the mutation-purity rule
// requires that no probe body READ a mutation switch. This test asserts the
// read-and-branch pattern explicitly.
test('H-2 hygiene AC-15401-1 SIMULATE_ purity across the four Cloudflare-platform probe trees', async () => {
  const hits = [];
  for (const bp of BLUEPRINTS) {
    for (const f of await probeFiles(bp)) {
      const body = await readFile(f, 'utf8');
      const re = /process\.env\.SIMULATE_[A-Z0-9_]+/g;
      let m;
      while ((m = re.exec(body)) !== null) hits.push(`${f}:${m[0]}`);
    }
  }
  assert.equal(hits.length, 0, `expected zero process.env.SIMULATE_* reads in probe bodies on the four Cloudflare-platform blueprints (mutation switches belong on the fixture side); observed: ${hits.slice(0, 6).join(' | ')}`);
});

// TS-184 / TC-184-envelope-hygiene-four-blueprints (AC-15401-2):
// Every committed envelope under .rcf/reports/blueprints/{four}/ carries
// aggregateVerdict pass. The envelope at
// .rcf/reports/blueprints/platform-cloudflare-kv/event-secrecy.json is a
// shipped-code pass envelope.
test('H-2 hygiene AC-15401-2 no fail or warn envelope committed under .rcf/reports on the four blueprints', async () => {
  // Read the COMMITTED envelope from git HEAD rather than the working tree.
  // The kv event-secrecy anatomy invokes the probe in process and validates
  // its results in memory; it does not write the report during test-suite
  // runs. This test asserts the committed record on the branch, which is
  // the input the shelf aggregate reads.
  let inspected = 0;
  const offenders = [];
  for (const bp of BLUEPRINTS) {
    const dir = join(REPO_ROOT, '.rcf', 'reports', 'blueprints', bp);
    if (!existsSync(dir)) continue;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.json')) continue;
      const relPath = relative(REPO_ROOT, join(dir, e.name));
      const gitShow = spawnSync('git', ['show', `HEAD:${relPath}`], { cwd: REPO_ROOT, encoding: 'utf8' });
      if (gitShow.status !== 0) continue;
      inspected += 1;
      let doc;
      try { doc = JSON.parse(gitShow.stdout); } catch { offenders.push(`${bp}/${e.name}=<invalid JSON>`); continue; }
      if (doc.aggregateVerdict !== 'pass') offenders.push(`${bp}/${e.name}=${doc.aggregateVerdict}`);
    }
  }
  assert.ok(inspected > 0, 'expected at least one committed envelope under .rcf/reports/blueprints/ on the four blueprints');
  assert.equal(offenders.length, 0, `expected every committed envelope to carry aggregateVerdict pass; offenders: ${offenders.join(', ')}`);
});

// TS-184 / TC-184-marker-hygiene-four-blueprints (AC-15401-3):
// Probe comments name in-process test doubles honestly; the block asserts
// the "fake" token does not appear in any probe body on the four
// blueprints.
test('H-2 hygiene AC-15401-3 probe comments name test doubles honestly on the four blueprints', async () => {
  const fakeHits = [];
  for (const bp of BLUEPRINTS) {
    for (const f of await probeFiles(bp)) {
      const body = await readFile(f, 'utf8');
      const re = /\bfake\b/gi;
      let m;
      while ((m = re.exec(body)) !== null) fakeHits.push(`${f}:${m[0]}`);
    }
  }
  assert.equal(fakeHits.length, 0, `expected zero "fake" tokens in probe bodies on the four Cloudflare-platform blueprints (probe bodies name in-process, in-memory, or synthetic test doubles and never use the "fake" token); observed: ${fakeHits.slice(0, 6).join(' | ')}`);
  // KV CHANGELOG and README describe the unsupported elicitedNonEmpty
  // predicate and the required loader-side capability extension.
  const kvChangelog = await readFile(join(REPO_ROOT, 'blueprints', 'platform-cloudflare-kv', 'CHANGELOG.md'), 'utf8');
  const kvReadme = await readFile(join(REPO_ROOT, 'blueprints', 'platform-cloudflare-kv', 'README.md'), 'utf8');
  assert.doesNotMatch(kvChangelog, /cannot yet gate/i, 'KV CHANGELOG must not carry the retired "cannot yet gate" wording');
  assert.doesNotMatch(kvReadme, /cannot yet gate/i, 'KV README must not carry the retired "cannot yet gate" wording');
  assert.match(kvChangelog, /loader-side capability extension/, 'KV CHANGELOG documents the loader-side capability extension required for the elicitedNonEmpty predicate');
  // The README documents the loader capability the predicate requires.
  assert.match(kvReadme, /an `elicitedNonEmpty` clause/, 'KV README documents the loader capability required for the elicitedNonEmpty predicate');
});
