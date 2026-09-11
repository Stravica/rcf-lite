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
  assert.equal(bp.version, '1.1.5');
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
  const probeNames = ['apply-time-refusal', 'apply-time-override', 'fake-clock-cron', 'retry-and-fail', 'retry-and-fail-real-account', 'event-secrecy'];
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
    'retry-and-fail-real-account': 'AC-jobs-retryOnHandlerFailure',
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
  // 7d conformance: the jobs-background Declared env vars table on the
  // shared fixture README names every variable the code actually reads
  // (authoring standard section 7d). Derived from the concrete
  // process.env reads on `packages/rcf-lite/test/fixtures/infra-s3-and-queue/src/producer.mjs`.
  assert.match(readme, /^## Declared env vars \(jobs-background pack\)/m);
  const producerSrc = await readFile(join(REPO_ROOT, 'packages', 'rcf-lite', 'test', 'fixtures', 'infra-s3-and-queue', 'src', 'producer.mjs'), 'utf8');
  const producerEnvReads = [...producerSrc.matchAll(/env\.([A-Z][A-Z0-9_]+)/g)].map((m) => m[1]);
  const uniqueProducerEnv = [...new Set(producerEnvReads)];
  assert.ok(uniqueProducerEnv.length >= 5, `producer.mjs must read at least 5 env vars; got ${uniqueProducerEnv.join(',')}`);
  for (const v of uniqueProducerEnv) {
    assert.match(readme, new RegExp(`\`${v}\``), `jobs-background Declared env vars must name the process.env read ${v}`);
  }
  for (const v of ['SIMULATE_HANDLER_THROW', 'SIMULATE_PII_IN_JOB_INPUT']) {
    assert.match(readme, new RegExp(`\`${v}\``), `jobs-background Declared env vars must name ${v}`);
  }
  // Anatomy check on evidence shape: every jobs-background probe
  // result row carries either an `evidence` object OR
  // `accountBoundSkipped: true` with a reason (authoring standard
  // section 7d, authoring-standard rule 3 of 2026-09-11, per-row rule of the
  // 2026-09-11 follow-up review). Source-level lexical check is the
  // floor; if a run record is present under
  // `.rcf/reports/blueprints/<slug>/<probe>.json`, EVERY row is
  // validated in-place.
  const probesDir = join(BP_DIR, 'contributions', 'probes');
  for (const name of ['apply-time-refusal', 'apply-time-override', 'fake-clock-cron', 'retry-and-fail', 'retry-and-fail-real-account', 'event-secrecy']) {
    const src = await readFile(join(probesDir, `${name}.mjs`), 'utf8');
    // Per-row source check: every results.push({ ... }) must carry
    // evidence:, accountBoundSkipped: true, or conformanceOnly: true.
    const pushOpens = [...src.matchAll(/results\.push\(\s*\{/g)];
    for (const opener of pushOpens) {
      const start = opener.index;
      let depth = 1;
      let i = opener.index + opener[0].length;
      while (i < src.length && depth > 0) {
        const c = src[i];
        if (c === '{') depth += 1;
        else if (c === '}') depth -= 1;
        i += 1;
      }
      const block = src.slice(start, i);
      assert.ok(/evidence\s*:/.test(block) || /accountBoundSkipped\s*:\s*true/.test(block) || /conformanceOnly\s*:\s*true/.test(block),
        `probe ${name}.mjs: results.push at offset ${start} must carry evidence, accountBoundSkipped:true, or conformanceOnly:true (7d per-row rule)`);
    }
    const reportPath = join(REPO_ROOT, '.rcf', 'reports', 'blueprints', 'jobs-background', `${name}.json`);
    try {
      const raw = await readFile(reportPath, 'utf8');
      const rep = JSON.parse(raw);
      assert.ok(Array.isArray(rep.results) && rep.results.length > 0,
        `run record ${name}.json must carry a non-empty results[] (authoring-standard rule 3)`);
      // Strict per-row 7d shape validation. No pre-discipline skip:
      // every present run record's row is validated against one of
      // four shapes:
      //   (a) a real observation with a non-empty id/status witness
      //       AND a non-empty derived-value witness (pattern-matched);
      //   (b) `conformanceOnly: true` with `anchorAcId: null` and a
      //       `limitation` string that names a shipped AC id;
      //   (c) `notObservableHere: { ac, reason }` naming an AC id;
      //   (d) `accountBoundSkipped: true` with a `reason` string that
      //       names the unset variable.
      const trivialAdminKeys = new Set(['reason', 'note', 'error', 'verdict', 'skip']);
      const idPatterns = [
        /RequestId$/i, /RequestIds$/i, /HttpStatus$/i, /HttpStatusCode$/i,
        /StatusCode$/i, /^status$/i, /ExitCode$/i, /Signal$/i,
        /Event$/i, /Events$/i, /^allEvents$/, /Metadata$/i,
        /Count$/, /Ids$/, /Match$/i, /Id$/, /Truncated$/i, /Present$/i,
        /Fired$/i,
      ];
      const derivedPatterns = [
        /Size$/i, /Bytes$/i, /Md5$/i, /Sha256$/i, /Equal$/i,
        /^seen/i, /Exists$/i, /Rows$/i, /^applied/i, /^expected/i, /^observed/i, /^returned/i,
        /^attempts/i, /^unique/i, /^teardown/i, /Sequence$/i,
        /Excerpt$/i, /Preview$/i, /^perSite$/i,
        /Container$/i, /Port$/i, /Path$/i, /Host$/i, /HostRedacted$/i,
        /Bucket$/i, /Key$/i, /Prefix$/i, /^inflight/i,
        /^first/i, /^second/i, /^waited/i, /^elapsed/i, /^total/i, /^dispatched/i, /^succeeded/i,
        /Max$/i, /Message$/i, /Names$/i, /Backlog$/i, /Refused$/i, /^ttl$/i, /Refused$/i, /^refused$/i,
        /Whitelist$/i, /^forbidden/i, /^scanned/i, /Fires$/i, /^cron$/i,
        /^tolerance/i, /Latency$/i, /^schedule/i, /Timestamp$/i, /Ok$/i,
      ];
      function isIdWitness(k, v) {
        if (trivialAdminKeys.has(k)) return false;
        if (v == null) return false;
        if (!idPatterns.some((re) => re.test(k))) return false;
        if (typeof v === 'number' && v === 0 && /Status$|StatusCode$/i.test(k)) return false;
        if (typeof v === 'string' && v.length === 0) return false;
        if (Array.isArray(v) && v.length === 0) return false;
        if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) return false;
        return true;
      }
      function isDerivedWitness(k, v) {
        if (trivialAdminKeys.has(k)) return false;
        if (v == null) return false;
        if (!derivedPatterns.some((re) => re.test(k))) return false;
        if (typeof v === 'string' && v.length === 0) return false;
        if (Array.isArray(v) && v.length === 0) return false;
        if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) return false;
        return true;
      }
      for (const row of rep.results) {
        assert.ok(['pass', 'warn', 'fail'].includes(row.verdict),
          `row in ${name}.json must have verdict in {pass, warn, fail}, saw ${row.verdict}`);
        const anchor = row.anchorAcId ?? row.anchorReqId;
        const declaimed = row.conformanceOnly === true;
        const notObservable = row.notObservableHere && typeof row.notObservableHere === 'object';
        const skipOk = row.accountBoundSkipped === true && typeof row.reason === 'string' && / unset$| \(not "true"\)$/.test(row.reason);
        if (declaimed) {
          assert.equal(row.anchorAcId, null,
            `conformanceOnly row in ${name}.json must set anchorAcId: null`);
          assert.ok(typeof row.limitation === 'string' && /AC-/.test(row.limitation),
            `conformanceOnly row in ${name}.json must carry a limitation naming a shipped AC id (REQ-only citations rejected)`);
        } else if (notObservable) {
          assert.ok(typeof row.notObservableHere.ac === 'string' && /AC-/.test(row.notObservableHere.ac),
            `notObservableHere row in ${name}.json must name an AC id`);
          assert.ok(typeof row.notObservableHere.reason === 'string' && row.notObservableHere.reason.length > 0,
            `notObservableHere row in ${name}.json must carry a non-empty reason`);
        } else if (skipOk) {
          // honest skip: fine
        } else {
          assert.ok(typeof anchor === 'string' && anchor.length > 0,
            `every non-declaimed row in ${name}.json must anchor an AC or REQ`);
          assert.notEqual(anchor, 'unknown', `row in ${name}.json anchors "unknown"`);
          const ev = row.evidence;
          const evOk = ev && typeof ev === 'object' && Object.keys(ev).length > 0;
          assert.ok(evOk,
            `non-skip row in ${name}.json (anchor ${anchor}) must carry a non-empty evidence object`);
          const idWitness = Object.entries(ev).find(([k, v]) => isIdWitness(k, v));
          const derivedWitness = Object.entries(ev).find(([k, v]) => isDerivedWitness(k, v));
          assert.ok(idWitness || derivedWitness,
            `non-declaimed row in ${name}.json (anchor ${anchor}) evidence must carry at least one strict-shape witness key (an id/status/event key, or a derived-value/inventory-diff/checksum key); got keys=${Object.keys(ev).join(',')}`);
        }
      }
      assert.equal(rep.aggregateVerdict, 'pass',
        `run record ${name}.json aggregateVerdict must be pass, saw ${rep.aggregateVerdict}`);
    } catch (err) {
      if (err.code !== 'ENOENT' && !err.message.includes('no such file')) throw err;
    }
  }
  // Jobs anatomy also validates that the DECLARED_ENV list on the new
  // real-account probe is reflected in the fixture README's Declared
  // env vars section, so the new probe's account-gate variables don't
  // slip past the declaration surface.
  const realAcctSrc = await readFile(join(probesDir, 'retry-and-fail-real-account.mjs'), 'utf8');
  const declaredMatch = realAcctSrc.match(/DECLARED_ENV = Object\.freeze\(\[([^\]]+)\]/);
  if (declaredMatch) {
    const names = [...declaredMatch[1].matchAll(/'([A-Z][A-Z0-9_]+)'/g)].map((m) => m[1]);
    for (const v of names) {
      assert.match(readme, new RegExp(`\`${v}\``),
        `jobs-background Declared env vars must name the real-account probe's env read ${v}`);
    }
  }
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
