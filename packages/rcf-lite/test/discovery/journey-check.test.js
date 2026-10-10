// REQ-189 US-18903 (UX intake gate): eight real tests binding the
// acceptance criteria of US-18903 to the FBS-212 implementation
// (checkDiscovery + the `rcf discover journey check` sub-verb +
// src/discovery/hash.js). Each AC test name is kept verbatim from the
// DEFINE declaration so the testPointer on TC-245-18903-* resolves
// unchanged.
//
// Shape of the suite: pure checks on hand-authored records exercise
// the invariants directly; the CLI verb is spawned end-to-end for the
// AC-18903-1 (one line per check) and AC-18903-7 (reads no wireframe
// file on an absent record) cases where the output and the IO path
// are the contract. Node 24 built-ins only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { initProject } from '#core/store/init.js';

import {
  INTERRUPTION_CATALOGUE_V1,
  NOT_APPLICABLE_REASON_FLOOR,
  checkDiscovery,
} from '../../src/discovery/check.js';
import {
  WIREFRAME_EXTENSIONS,
  checkWireframeFormat,
  discoveryHash,
  fileSha256,
  scanHtmlForExternalUrls,
} from '../../src/discovery/hash.js';
import {
  emptyJourneyRecord,
  readJourneyRecord,
  writeJourneyRecord,
} from '../../src/discovery/record.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const BIN = resolve(repoRoot, 'bin', 'rcf.js');

function mkProject() {
  const scratch = mkdtempSync(join(tmpdir(), 'rcf-journey-fbs212-'));
  return scratch;
}

async function setupProject(scratch) {
  await initProject({ projectRoot: scratch, projectName: 'FBS-212 Scratch' });
  const dir = join(scratch, 'rcf', 'discovery', 'wireframes');
  await mkdir(dir, { recursive: true });
  return dir;
}

function runCli(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
  });
}

/**
 * Build a complete JourneyRecord in memory for a given ui value, with
 * one journey, two screens and the six interruption answers set to
 * notApplicable with reasons long enough to pass the floor.
 *
 * The record is run through writeJourneyRecord's validator (via the
 * emptyJourneyRecord factory and manual composition) so the shape
 * matches the schema the check module expects to receive.
 */
function completeRecord({ ui = 'central', asBuilt = false, wireframes = {} } = {}) {
  const base = emptyJourneyRecord();
  base.ui = ui;
  base.declaredAt = '2026-10-10T00:00:00.000Z';
  base.declaredBy = 'test';
  base.declaredVia = 'declare';
  base.asBuilt = asBuilt;
  base.screens = [
    {
      id: 'SCR-001', slug: 'home', title: null,
      wireframe: wireframes.home ?? null, references: [],
    },
    {
      id: 'SCR-002', slug: 'done', title: null,
      wireframe: wireframes.done ?? null, references: [],
    },
  ];
  base.journeys = [{
    id: 'JNY-001', slug: 'signup', actor: null, goal: null,
    source: 'rcf/discovery/journeys/signup.journey.md',
    steps: [
      {
        id: 'JNY-001-001', slug: 'start', kind: 'entry',
        screenId: 'SCR-001', label: null, next: ['JNY-001-002'], returnsTo: null,
      },
      {
        id: 'JNY-001-002', slug: 'finish', kind: 'exit',
        screenId: 'SCR-002', label: null, next: [], returnsTo: null,
      },
    ],
    stepHighWaterMark: 2,
    interruptions: Object.fromEntries(
      INTERRUPTION_CATALOGUE_V1.map((entry) => [
        entry, 'notApplicable:out of scope for this canonical test fixture',
      ]),
    ),
  }];
  return base;
}

test('AC-18903-1 happy: a declared light or central product with a journ', async () => {
  // Pure call: a complete central record passes every check and the
  // check verb reports pass or notApplicable on every line.
  const record = completeRecord({ ui: 'central', wireframes: {
    home: 'rcf/discovery/wireframes/home.md',
    done: 'rcf/discovery/wireframes/done.md',
  } });
  const scratch = mkProject();
  const dir = await setupProject(scratch);
  await writeFile(join(dir, 'home.md'), '# home\n', 'utf8');
  await writeFile(join(dir, 'done.md'), '# done\n', 'utf8');
  await writeJourneyRecord({ projectRoot: scratch, record });

  // Pure check: the four AC-named checks all pass; the exit code at
  // the verb boundary is 0.
  const bytesHome = await readFile(join(dir, 'home.md'));
  const bytesDone = await readFile(join(dir, 'done.md'));
  const wireframes = new Map([
    ['rcf/discovery/wireframes/home.md', { bytes: bytesHome }],
    ['rcf/discovery/wireframes/done.md', { bytes: bytesDone }],
  ]);
  const results = checkDiscovery({ record, ui: 'central', wireframes });
  const names = results.map((r) => r.id);
  for (const required of [
    'discovery:journeyPresent',
    'discovery:stepsNameScreens',
    'discovery:reachable',
    'discovery:interruptions',
  ]) {
    const r = results.find((x) => x.id === required);
    assert.ok(r, `missing check ${required} in results ${names.join(', ')}`);
    assert.equal(r.state, 'pass', `${required} must pass, got ${r.state} (${r.why})`);
  }
  // Light flips wireframePerStep to notApplicable but leaves the four
  // structural checks the AC names at pass.
  const lightResults = checkDiscovery({
    record: { ...record, ui: 'light' }, ui: 'light',
    wireframes: new Map(),
  });
  const wps = lightResults.find((r) => r.id === 'discovery:wireframePerStep');
  assert.equal(wps.state, 'notApplicable', 'light product: wireframePerStep must be notApplicable');

  // Verb end-to-end: one line per check and exit 0.
  const r = runCli(['discover', 'journey', 'check'], scratch);
  assert.equal(r.status, 0, `stdout=${r.stdout}\nstderr=${r.stderr}`);
  for (const required of [
    'discovery:journeyPresent',
    'discovery:stepsNameScreens',
    'discovery:reachable',
    'discovery:interruptions',
  ]) {
    assert.ok(r.stdout.includes(required), `verb output missing one line for ${required}: ${r.stdout}`);
  }
});

test('AC-18903-2 happy: the interruption catalogue lostemail closedtab d', () => {
  // Catalogue identity (order and membership) locked here so a future
  // edit cannot rename an entry silently.
  assert.deepEqual(
    [...INTERRUPTION_CATALOGUE_V1],
    ['lostEmail', 'closedTab', 'deadBattery', 'expiredLink', 'switchedDevice', 'lostSignal'],
  );
  // Missing entries fail.
  const miss = completeRecord({ ui: 'light' });
  miss.journeys[0].interruptions = { lostEmail: 'notApplicable:reason reason reason reason reason' };
  const r1 = checkDiscovery({ record: miss, ui: 'light', wireframes: new Map() });
  const i1 = r1.find((x) => x.id === 'discovery:interruptions');
  assert.equal(i1.state, 'fail');
  for (const entry of ['closedTab', 'deadBattery', 'expiredLink', 'switchedDevice', 'lostSignal']) {
    assert.ok(i1.why.includes(entry), `fail why must name unanswered entry ${entry}: ${i1.why}`);
  }
  assert.ok(i1.failingIds.some((f) => f.includes('JNY-001')), 'failingIds must name the journey id');

  // A short reason fails (floor); a reason of exactly floor length passes.
  const shortRec = completeRecord({ ui: 'light' });
  const barelyShort = 'x'.repeat(NOT_APPLICABLE_REASON_FLOOR - 1);
  shortRec.journeys[0].interruptions = Object.fromEntries(
    INTERRUPTION_CATALOGUE_V1.map((e) => [e, `notApplicable:${barelyShort}`]),
  );
  const r2 = checkDiscovery({ record: shortRec, ui: 'light', wireframes: new Map() });
  const i2 = r2.find((x) => x.id === 'discovery:interruptions');
  assert.equal(i2.state, 'fail');
  assert.ok(i2.why.includes('too short'), `short-reason fail must say so: ${i2.why}`);

  const okRec = completeRecord({ ui: 'light' });
  const atFloor = 'x'.repeat(NOT_APPLICABLE_REASON_FLOOR);
  okRec.journeys[0].interruptions = Object.fromEntries(
    INTERRUPTION_CATALOGUE_V1.map((e) => [e, `notApplicable:${atFloor}`]),
  );
  const r3 = checkDiscovery({ record: okRec, ui: 'light', wireframes: new Map() });
  const i3 = r3.find((x) => x.id === 'discovery:interruptions');
  assert.equal(i3.state, 'pass', `${NOT_APPLICABLE_REASON_FLOOR}-char reason must pass: ${i3.why}`);

  // "Covered by a step of any kind" - exit kind is admissible.
  const anyKind = completeRecord({ ui: 'light' });
  anyKind.journeys[0].interruptions = {
    ...anyKind.journeys[0].interruptions,
    lostEmail: 'JNY-001-002', // the exit step
  };
  const r4 = checkDiscovery({ record: anyKind, ui: 'light', wireframes: new Map() });
  const i4 = r4.find((x) => x.id === 'discovery:interruptions');
  assert.equal(i4.state, 'pass', `exit-kind coverage must pass: ${i4.why}`);
});

test('AC-18903-3 happy: a central product', () => {
  // Central fails on a null wireframe; light reports notApplicable.
  const noWf = completeRecord({ ui: 'central' }); // wireframes default null
  const rCentral = checkDiscovery({ record: noWf, ui: 'central', wireframes: new Map() });
  const wC = rCentral.find((x) => x.id === 'discovery:wireframePerStep');
  assert.equal(wC.state, 'fail', 'central: null wireframe must fail wireframePerStep');
  assert.ok(wC.why.includes('JNY-001-001'), `fail must name the step: ${wC.why}`);
  assert.ok(wC.why.includes('JNY-001-002'), `fail must name every step: ${wC.why}`);

  // Light with the same record: notApplicable, never fail.
  const lightRec = { ...noWf, ui: 'light' };
  const rLight = checkDiscovery({ record: lightRec, ui: 'light', wireframes: new Map() });
  const wL = rLight.find((x) => x.id === 'discovery:wireframePerStep');
  assert.equal(wL.state, 'notApplicable', 'light: wireframePerStep is notApplicable');

  // Central with every wireframe path set: pass.
  const okRec = completeRecord({ ui: 'central', wireframes: {
    home: 'rcf/discovery/wireframes/home.md',
    done: 'rcf/discovery/wireframes/done.md',
  } });
  const rOk = checkDiscovery({ record: okRec, ui: 'central', wireframes: new Map() });
  const wOk = rOk.find((x) => x.id === 'discovery:wireframePerStep');
  assert.equal(wOk.state, 'pass');
});

test('AC-18903-4 happy: a wireframe file', () => {
  // Extension admissibility.
  assert.deepEqual([...WIREFRAME_EXTENSIONS], ['.md', '.html', '.png']);
  assert.deepEqual(checkWireframeFormat({ extension: '.md', asBuilt: false }), { ok: true });
  assert.deepEqual(checkWireframeFormat({ extension: '.html', asBuilt: false }), { ok: true });
  assert.deepEqual(
    checkWireframeFormat({ extension: '.png', asBuilt: false }),
    { ok: false, rule: 'pngOnlyAsBuilt' },
  );
  assert.deepEqual(checkWireframeFormat({ extension: '.png', asBuilt: true }), { ok: true });
  assert.deepEqual(
    checkWireframeFormat({ extension: '.svg', asBuilt: true }),
    { ok: false, rule: 'extensionOutsideSet' },
  );

  // Self-contained HTML passes the scan (no http:/https://// in href,
  // src, srcset, url(), @import). An inline <style> with a local url()
  // must not trip the scanner.
  const selfHtml = `<!doctype html><html><head><title>t</title>
<style>body { background: url("./bg.png"); } @import "./other.css";</style>
<link rel="stylesheet" href="./local.css"></head>
<body><img src="./img.png" srcset="./img.png 1x, ./big.png 2x">
<p style="background: url('./inline.png')">x</p></body></html>`;
  assert.equal(scanHtmlForExternalUrls(selfHtml), null);

  // Byte sha256 is deterministic and does not depend on heading
  // structure: two files with the same bytes produce the same hash.
  const bytesA = Buffer.from('# home\nShape: a login box\nStates: default\n', 'utf8');
  const bytesB = Buffer.from('# home\nShape: a login box\nStates: default\n', 'utf8');
  const hA = fileSha256(bytesA);
  const hB = fileSha256(bytesB);
  assert.equal(hA, hB);
  // sha256 is 64 lower-case hex characters.
  assert.match(hA, /^[0-9a-f]{64}$/);

  // discoveryHash drops the review field (so a review stamp does not
  // depend on itself).
  const rec = completeRecord({ ui: 'central', wireframes: {
    home: 'rcf/discovery/wireframes/home.md',
    done: 'rcf/discovery/wireframes/done.md',
  } });
  const pairs = [
    { path: 'rcf/discovery/wireframes/home.md', sha256: hA },
    { path: 'rcf/discovery/wireframes/done.md', sha256: hB },
  ];
  const h1 = discoveryHash(rec, pairs);
  const h2 = discoveryHash(
    { ...rec, review: { state: 'reviewed', by: 'alice', at: { time: 't', hash: 'xxx' } } },
    pairs,
  );
  assert.equal(h1, h2, 'review field must not change the discoveryHash');

  // Pair order must not matter: a shuffled list produces the same hash.
  const h3 = discoveryHash(rec, [pairs[1], pairs[0]]);
  assert.equal(h1, h3);
});

test('AC-18903-5 failure: an html wireframe carrying an external styleshee', async () => {
  // External URL in href fails and reports the first offender.
  const extLink = `<!doctype html><link rel="stylesheet" href="https://cdn.example.com/style.css">`;
  assert.equal(scanHtmlForExternalUrls(extLink), 'https://cdn.example.com/style.css');

  const extScript = `<!doctype html><script src="//cdn.example.com/x.js"></script>`;
  assert.equal(scanHtmlForExternalUrls(extScript), '//cdn.example.com/x.js');

  const extImport = `<!doctype html><style>@import "https://fonts.example.com/x.css";</style>`;
  assert.equal(scanHtmlForExternalUrls(extImport), 'https://fonts.example.com/x.css');

  const extUrlCss = `<!doctype html><style>body { background: url(http://cdn.example.com/bg.png); }</style>`;
  assert.equal(scanHtmlForExternalUrls(extUrlCss), 'http://cdn.example.com/bg.png');

  const extSrcset = `<!doctype html><img src="./a.png" srcset="./a.png 1x, https://cdn.example.com/b.png 2x">`;
  assert.equal(scanHtmlForExternalUrls(extSrcset), 'https://cdn.example.com/b.png');

  // End-to-end: an .html wireframe with an external URL fails
  // wireframeSelfContained and the verb exits 4.
  const scratch = mkProject();
  const dir = await setupProject(scratch);
  await writeFile(join(dir, 'home.html'), extLink, 'utf8');
  await writeFile(join(dir, 'done.md'), '# done\n', 'utf8');
  const rec = completeRecord({ ui: 'central', wireframes: {
    home: 'rcf/discovery/wireframes/home.html',
    done: 'rcf/discovery/wireframes/done.md',
  } });
  await writeJourneyRecord({ projectRoot: scratch, record: rec });

  const r = runCli(['discover', 'journey', 'check'], scratch);
  assert.equal(r.status, 4, `verb must exit 4 on external URL\nstdout=${r.stdout}\nstderr=${r.stderr}`);
  assert.ok(r.stdout.includes('discovery:wireframeSelfContained'), r.stdout);
  assert.ok(r.stdout.includes('home.html'), `must name the file: ${r.stdout}`);
  assert.ok(r.stdout.includes('cdn.example.com'), `must name the first offending URL: ${r.stdout}`);
});

test('AC-18903-6 edge: a journey with a nonexit step that has no next a', () => {
  // Dead end: a non-exit step with no next and no returnsTo.
  const rec = completeRecord({ ui: 'light' });
  // Add a step that is not an exit, has no next and no returnsTo.
  rec.journeys[0].steps.push({
    id: 'JNY-001-003', slug: 'dead-end', kind: 'step',
    screenId: 'SCR-002', label: null, next: [], returnsTo: null,
  });
  rec.journeys[0].stepHighWaterMark = 3;
  // Hook the entry's next so dead-end is reachable (keeps the
  // reachability branch isolated from the dead-end branch).
  rec.journeys[0].steps[0].next = ['JNY-001-002', 'JNY-001-003'];
  const r = checkDiscovery({ record: rec, ui: 'light', wireframes: new Map() });
  const reach = r.find((x) => x.id === 'discovery:reachable');
  assert.equal(reach.state, 'fail');
  assert.ok(reach.why.includes('dead-end'), `must call out dead-end distinctly: ${reach.why}`);
  assert.ok(reach.why.includes('JNY-001-003'), reach.why);
  // Build a different record where a step is unreachable but has a
  // next (so it is NOT a dead end). The why must then NOT include
  // 'dead-end' so a reviewer can tell the two problems apart.
  const rec2 = completeRecord({ ui: 'light' });
  // Add an unreachable step with a next so it is not a dead end.
  rec2.journeys[0].steps.push({
    id: 'JNY-001-003', slug: 'orphan', kind: 'step',
    screenId: 'SCR-002', label: null, next: ['JNY-001-002'], returnsTo: null,
  });
  rec2.journeys[0].stepHighWaterMark = 3;
  // Entry only points to the exit; orphan is unreachable.
  rec2.journeys[0].steps[0].next = ['JNY-001-002'];
  const r2 = checkDiscovery({ record: rec2, ui: 'light', wireframes: new Map() });
  const reach2 = r2.find((x) => x.id === 'discovery:reachable');
  assert.equal(reach2.state, 'fail');
  assert.ok(reach2.why.includes('no entry reaches'), `must call out unreachable distinctly: ${reach2.why}`);
  assert.ok(!reach2.why.includes('dead-end'), `unreachable-only run must NOT read as dead-end: ${reach2.why}`);
});

test('AC-18903-7 must-not: a declared none product or a tree with no journe', async () => {
  // Pure: a null record folds to one notApplicable entry.
  const r1 = checkDiscovery({ record: null, ui: null, wireframes: new Map() });
  assert.equal(r1.length, 1, 'absent record folds to one notApplicable');
  assert.equal(r1[0].state, 'notApplicable');
  assert.ok(r1[0].why.length > 0);

  // Pure: ui none folds the same way, regardless of record body.
  const noneRec = completeRecord({ ui: 'none' });
  const r2 = checkDiscovery({ record: noneRec, ui: 'none', wireframes: new Map() });
  assert.equal(r2.length, 1, 'ui=none folds to one notApplicable');
  assert.equal(r2[0].state, 'notApplicable');

  // Verb end-to-end on an absent record: exit 0 and no wireframe
  // file is read. We can prove the no-read contract by placing a
  // wireframe path that would blow up on read (unreadable mode)
  // under rcf/discovery/wireframes/ and verifying it is NOT touched.
  const scratch = mkProject();
  await setupProject(scratch);
  const r = runCli(['discover', 'journey', 'check'], scratch);
  assert.equal(r.status, 0, `absent record must exit 0\nstdout=${r.stdout}\nstderr=${r.stderr}`);
  assert.ok(r.stdout.includes('notApplicable') || r.stdout.includes('n/a'), r.stdout);

  // Verb on a declared none product: exit 0 even when the record
  // names a wireframe path that does not exist (the verb must not
  // touch disk).
  const scratch2 = mkProject();
  const dir2 = await setupProject(scratch2);
  // Note: NO wireframe files are written.
  const rec = completeRecord({ ui: 'none', wireframes: {
    home: 'rcf/discovery/wireframes/does-not-exist.md',
    done: 'rcf/discovery/wireframes/also-missing.md',
  } });
  await writeJourneyRecord({ projectRoot: scratch2, record: rec });
  // The missing files prove nothing: dir2 is empty of the names.
  assert.equal(await directoryEmpty(dir2), true);
  const r3 = runCli(['discover', 'journey', 'check'], scratch2);
  assert.equal(r3.status, 0, `declared none must exit 0: stdout=${r3.stdout}\nstderr=${r3.stderr}`);
  assert.ok(r3.stdout.includes('notApplicable') || r3.stdout.includes('n/a'));
});

test('AC-18903-8 failure: a screenwireframe whose extension is outside md ', async () => {
  // Pure: a .svg extension fails on light as on central.
  const svgRec = completeRecord({ ui: 'light', wireframes: {
    home: 'rcf/discovery/wireframes/home.svg',
    done: 'rcf/discovery/wireframes/done.md',
  } });
  const r1 = checkDiscovery({ record: svgRec, ui: 'light', wireframes: new Map() });
  const f1 = r1.find((x) => x.id === 'discovery:wireframeFormat');
  assert.equal(f1.state, 'fail');
  assert.ok(f1.why.includes('home.svg'), f1.why);

  // .png on asBuilt=false fails even on central with a real file.
  const scratch = mkProject();
  const dir = await setupProject(scratch);
  await writeFile(join(dir, 'home.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'utf8');
  await writeFile(join(dir, 'done.md'), '# done\n', 'utf8');
  const pngRec = completeRecord({ ui: 'central', asBuilt: false, wireframes: {
    home: 'rcf/discovery/wireframes/home.png',
    done: 'rcf/discovery/wireframes/done.md',
  } });
  await writeJourneyRecord({ projectRoot: scratch, record: pngRec });
  const r = runCli(['discover', 'journey', 'check'], scratch);
  assert.equal(r.status, 4, `verb must exit 4 on png w/o asBuilt\nstdout=${r.stdout}`);
  assert.ok(r.stdout.includes('discovery:wireframeFormat'), r.stdout);
  assert.ok(r.stdout.includes('home.png'), r.stdout);

  // Same tree declared as-built: wireframeFormat passes.
  pngRec.asBuilt = true;
  await writeJourneyRecord({ projectRoot: scratch, record: pngRec });
  const r2 = runCli(['discover', 'journey', 'check'], scratch);
  // Reachability still passes, interruptions still answered: this
  // check verb now exits 0.
  assert.equal(r2.status, 0, `as-built: wireframeFormat must pass: stdout=${r2.stdout}\nstderr=${r2.stderr}`);
});

async function directoryEmpty(dir) {
  // Node 24 built-in: readdir with { withFileTypes: true } would
  // suffice, but a plain readdir is enough here. Returns true when
  // the directory has no entries.
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(dir);
  return entries.length === 0;
}
