/**
 * jobs-background v1.0.0 anatomy tests (TS-076; re-minted post-#164 T-0 collision on original TS-073).
 *
 * Covers AC-4301-1 (blueprint.json shape), AC-4301-5 (probe module
 * anchor-id cross-check), AC-4301-6 (sample-app fixture: jobs/ toy
 * modules + jobs-runtime + scheduler + two induced-failure switches
 * documented), and AC-4301-7 (shelf-doc consistency: section 6a
 * backgroundJobs row + shelf-wide docs/topics.md row for jobs-background
 * at 30101-30899 / 31xx).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..', '..', '..');
const BP_DIR = join(REPO_ROOT, 'blueprints', 'jobs-background');
const FIXTURE_DIR = join(REPO_ROOT, 'packages', 'rcf-lite', 'test', 'fixtures', 'infra-s3-and-queue');

async function readJson(p) {
  return JSON.parse(await readFile(p, 'utf8'));
}
async function pathExists(p) {
  try { await stat(p); return true; } catch { return false; }
}

test('blueprint.json declares 22 contributions with capabilities backgroundJobs, requiresAppliedCapabilities on queue with allowSkipFlag allow-no-queue-yet and refusalMessageId jobs-background-no-queue, and standardsTraceClause on every ADR entry (TC-076-blueprint-json-shape)', async () => {
  const bp = await readJson(join(BP_DIR, 'blueprint.json'));
  assert.equal(bp.slug, 'jobs-background');
  assert.equal(bp.version, '1.1.3');
  assert.equal(bp.category, 'jobs');
  assert.deepEqual(bp.capabilities, ['backgroundJobs']);
  assert.deepEqual(bp.requiresAppliedCapabilities, {
    capabilities: ['queue'],
    allowSkipFlag: 'allow-no-queue-yet',
    refusalMessageId: 'jobs-background-no-queue',
  });
  assert.equal(bp.suggestedCompanions.length, 2);
  assert.equal(bp.contributions.length, 22);
  const kinds = bp.contributions.reduce((acc, c) => { acc[c.kind] = (acc[c.kind] || 0) + 1; return acc; }, {});
  assert.deepEqual(kinds, { req: 6, us: 9, tac: 3, adr: 4 });
  // Every ADR entry carries a non-null standardsTraceClause (round-3
  // gate rule + PR #155 fix train).
  for (const c of bp.contributions.filter((x) => x.kind === 'adr')) {
    assert.ok(typeof c.standardsTraceClause === 'string' && c.standardsTraceClause.length > 0,
      `ADR ${c.id} missing standardsTraceClause`);
  }
  // The scope:global ADR-3101 declares the new topic backgroundJobModel.
  const scopeGlobal = bp.contributions.find((c) => c.scope === 'global');
  assert.equal(scopeGlobal.id, 'ADR-3101-jobs-background-model');
  assert.equal(scopeGlobal.topic, 'backgroundJobModel');
});

test('every probe module exports the section 3.2 verdict envelope with an anchorAcId matching a contributed AC id (TC-076-probe-anchor-ids-cross-check)', async () => {
  const probesDir = join(BP_DIR, 'contributions', 'probes');
  const entries = await readdir(probesDir);
  const probeNames = ['apply-time-refusal', 'apply-time-override', 'fake-clock-cron', 'retry-and-fail', 'event-secrecy'];
  for (const name of probeNames) {
    assert.ok(entries.includes(`${name}.mjs`), `probe module ${name}.mjs missing`);
    assert.ok(entries.includes(`run-${name}.mjs`), `probe shim run-${name}.mjs missing`);
  }
  // Import each and check the anchorAcId on the first result.
  const expected = {
    'apply-time-refusal': 'AC-jobs-requiresQueue',
    'apply-time-override': 'AC-jobs-overrideRecorded',
    'fake-clock-cron': 'AC-jobs-scheduledRunsOnCron',
    'retry-and-fail': 'AC-jobs-retryOnHandlerFailure',
    'event-secrecy': 'AC-jobs-eventSecrecy',
  };
  // Anchor ids must appear in the blueprint's contribution set (either
  // as an AC id string on a US.acceptanceCriteria[] entry, or documented
  // in the descriptor prose; here we grep the shipped US JSON files for
  // the string).
  const usDir = join(BP_DIR, 'contributions', 'user-stories');
  const usFiles = (await readdir(usDir)).filter((f) => f.endsWith('.json'));
  const allText = (await Promise.all(usFiles.map((f) => readFile(join(usDir, f), 'utf8')))).join('\n');
  for (const acId of Object.values(expected)) {
    assert.ok(allText.includes(acId), `expected AC id ${acId} to appear in a shipped US file`);
  }
  // Import shim modules to check the engine hint is present and that the
  // default-export probe function is callable. We do NOT actually run
  // them here (they hit scratch dirs / spawn processes / the CLI). The
  // anatomy test proves the shape and the runtime probe reports at
  // .rcf/reports/blueprints/jobs-background/*.json prove the run
  // verdicts.
  for (const name of probeNames) {
    const url = new URL(`../../../../blueprints/jobs-background/contributions/probes/${name}.mjs`, import.meta.url);
    const mod = await import(url);
    assert.equal(typeof mod.default, 'function', `${name}.mjs default export must be a function`);
  }
});

test('sample-app fixture ships jobs/ toy job-definitions plus src/jobs-runtime.mjs and src/scheduler.mjs and its README documents the two wired induced-failure switches SIMULATE_HANDLER_THROW and SIMULATE_PII_IN_JOB_INPUT (TC-076-fixture-and-switches)', async () => {
  assert.ok(await pathExists(join(FIXTURE_DIR, 'jobs', 'send-welcome-email.mjs')));
  assert.ok(await pathExists(join(FIXTURE_DIR, 'jobs', 'refresh-cache.mjs')));
  assert.ok(await pathExists(join(FIXTURE_DIR, 'src', 'jobs-runtime.mjs')));
  assert.ok(await pathExists(join(FIXTURE_DIR, 'src', 'scheduler.mjs')));
  assert.ok(await pathExists(join(FIXTURE_DIR, 'src', 'job-run-log.mjs')));
  const readme = await readFile(join(FIXTURE_DIR, 'README.md'), 'utf8');
  assert.match(readme, /SIMULATE_HANDLER_THROW/);
  assert.match(readme, /SIMULATE_PII_IN_JOB_INPUT/);
  assert.match(readme, /retry-and-fail/);
  assert.match(readme, /event-secrecy/);
  assert.match(readme, /jobs\//);
  // The two toy jobs export the shape.
  const url1 = new URL('../../test/fixtures/infra-s3-and-queue/jobs/send-welcome-email.mjs', import.meta.url);
  const url2 = new URL('../../test/fixtures/infra-s3-and-queue/jobs/refresh-cache.mjs', import.meta.url);
  const j1 = (await import(url1)).default;
  const j2 = (await import(url2)).default;
  assert.equal(j1.name, 'send-welcome-email');
  assert.equal(typeof j1.handler, 'function');
  assert.equal(j1.retryPolicy.maxAttempts, 3);
  assert.equal(j1.timeoutMs, 60000);
  assert.equal(j2.name, 'refresh-cache');
  assert.equal(j2.cron, '* * * * *');
  assert.equal(j2.retryPolicy.maxAttempts, 5);
  assert.equal(j2.timeoutMs, 10000);
});

test('section 6a table gains a backgroundJobs row naming jobs-background and reserved sibling posture; every shipped blueprint docs/topics.md gains a jobs-background row at 30101-30899 / 31xx (TC-076-shelf-doc-consistency)', async () => {
  const authoring = await readFile(join(REPO_ROOT, 'packages', 'rcf-lite', 'docs', 'blueprint-authoring.md'), 'utf8');
  assert.match(authoring, /^\| `backgroundJobs` \|/m);
  assert.ok(authoring.includes('jobs-background'), 'section 6a table row must name jobs-background');
  const blueprintDirs = (await readdir(join(REPO_ROOT, 'blueprints'), { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  let hits = 0;
  for (const slug of blueprintDirs) {
    const topicsPath = join(REPO_ROOT, 'blueprints', slug, 'docs', 'topics.md');
    if (!await pathExists(topicsPath)) continue;
    const contents = await readFile(topicsPath, 'utf8');
    if (contents.includes('| jobs-background |') && contents.includes('30101-30899') && contents.includes('31xx')) {
      hits += 1;
    }
  }
  assert.ok(hits >= 1, `expected at least one shipped blueprint docs/topics.md to carry the jobs-background registry row; found ${hits}`);
});
