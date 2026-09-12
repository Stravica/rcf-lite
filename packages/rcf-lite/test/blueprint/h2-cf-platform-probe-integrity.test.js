// H-2 cross-cutting probe-integrity anatomy test for the H-2 hardening train
// (`h2-cf-platform-probe-integrity`). Covers TS-184: SIMULATE_ purity across
// the four Cloudflare-platform blueprints (AC-15401-1), envelope hygiene under
// .rcf/reports (AC-15401-2), and probe-comment honesty (AC-15401-3).

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
// SIMULATE_ token appears in two round-5 T-3 messaging-queue-cloudflare probes
// (retry-and-dlq.mjs, event-secrecy.mjs) exclusively as env-name pass-through
// strings passed into a fixture-side child consumer (documented in the H-2 PR
// body section 6.2 as a judgement call under brief section 8; the underlying
// mutation-purity rule requires that no probe body READ a mutation switch, and
// that rule is met). This test asserts the read-and-branch pattern explicitly.
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
  assert.equal(hits.length, 0, `expected zero process.env.SIMULATE_* reads in probe bodies on the four H-2 blueprints (mutation switches belong on the fixture side per brief section 5); observed: ${hits.slice(0, 6).join(' | ')}`);
});

// TS-184 / TC-184-envelope-hygiene-four-blueprints (AC-15401-2):
// Every committed envelope under .rcf/reports/blueprints/{four}/ carries
// aggregateVerdict pass. The previously committed fail envelope at
// .rcf/reports/blueprints/platform-cloudflare-kv/event-secrecy.json is replaced
// with a shipped-code pass envelope. This is the Group A gate promoted to a
// durable test.
test('H-2 hygiene AC-15401-2 no fail or warn envelope committed under .rcf/reports on the four blueprints', async () => {
  // Read the COMMITTED envelope from git HEAD rather than the working tree.
  // The kv event-secrecy anatomy child spawn overwrites its local envelope
  // with a mutation-run FAIL record during test-suite runs (Group A caveat);
  // this test asserts the durable committed state on the branch, which is the
  // gate the aggregator evaluates.
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
// Probe comments name test doubles honestly. The stage-1 marker:fake rows on
// the four blueprints have all been reworded (Groups A/B) to name in-process
// implementations honestly; the "fake" token no longer survives in any probe
// body on the four blueprints. Follow-up "not yet" wording in the KV
// CHANGELOG/README was reworded at D2 with an explicit follow-up work-item
// pointer.
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
  assert.equal(fakeHits.length, 0, `expected zero "fake" tokens in probe bodies on the four H-2 blueprints (rewored to name in-process / in-memory / synthetic test doubles honestly per H-2 Groups A/B); observed: ${fakeHits.slice(0, 6).join(' | ')}`);
  // KV "not yet" reword: CHANGELOG and README should carry the follow-up
  // work-item pointer instead of the "cannot yet gate" wording.
  const kvChangelog = await readFile(join(REPO_ROOT, 'blueprints', 'platform-cloudflare-kv', 'CHANGELOG.md'), 'utf8');
  const kvReadme = await readFile(join(REPO_ROOT, 'blueprints', 'platform-cloudflare-kv', 'README.md'), 'utf8');
  assert.doesNotMatch(kvChangelog, /cannot yet gate/i, 'KV CHANGELOG must not carry "cannot yet gate" wording after D2 reword');
  assert.doesNotMatch(kvReadme, /cannot yet gate/i, 'KV README must not carry "cannot yet gate" wording after D2 reword');
  assert.match(kvChangelog, /a loader-capability follow-up/, 'KV CHANGELOG names the loader-capability follow-up in neutral terms');
  // The README carries no internal work-item ids; the CHANGELOG can retain them.
  // The README still names the follow-up as a capability change out of scope for this patch.
  assert.match(kvReadme, /follow-up capability change/, 'KV README names the follow-up capability change');
});
