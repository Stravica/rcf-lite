// REQ-189 US-18901 (UX intake gate): seven real tests binding the
// seven acceptance criteria of US-18901 to the FBS-211 implementation.
// Each AC test name is kept verbatim from the DEFINE declaration so
// the testPointer on TC-243-18901-* resolves unchanged; the todo flag
// and placeholder bodies from the DEFINE scaffold are replaced with
// real coverage. Node 24 built-ins only.
//
// FBS-211 review fold-in (F12): declaredAt is bounded on both sides;
// lowering has light->none and central->none cases plus a whitespace-
// reason refusal; AC-3 drives promptForUi through injected TTY-marked
// streams for signal and no-signal with a typed answer that differs
// from the mechanical proposal; AC-4 covers a signal-bearing artefact;
// AC-5 asserts the printed JourneyRecord on both dry-runs; AC-7
// asserts --fix notices, drift, and exit code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { readFile, writeFile, mkdir, stat, unlink, rm } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { initProject } from '#core/store/init.js';
import {
  JOURNEY_FILE,
  readJourneyRecord,
} from '../../src/discovery/record.js';
import { promptForUi } from '../../src/cli/intake.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const BIN = resolve(repoRoot, 'bin', 'rcf.js');

function mkProject() {
  return mkdtempSync(join(tmpdir(), 'rcf-journey-fbs211-'));
}

async function initTree(scratch, { stripSeed = false } = {}) {
  await initProject({ projectRoot: scratch, projectName: 'FBS-211 Scratch' });
  if (stripSeed) {
    // AC-18901-5 grandfathered state means both the file and the
    // rcf/discovery/ subtree are absent. initProject seeds both as a
    // side-effect; strip them so the tests exercise the true
    // pre-FBS-211 shape.
    try { await rm(join(scratch, 'rcf', 'discovery'), { recursive: true, force: true }); } catch { /* already absent */ }
  }
}

function runCli(args, cwd, extraEnv = {}) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', ...extraEnv },
  });
}

async function fileExists(path) {
  try { await stat(path); return true; } catch { return false; }
}

// Collect every chunk written to a stream into a single string. The
// in-process promptForUi test needs this to inspect the proposal line
// and the signals line.
function captureStream() {
  const chunks = [];
  const s = new PassThrough();
  s.on('data', (c) => chunks.push(typeof c === 'string' ? c : c.toString('utf8')));
  return { stream: s, text: () => chunks.join('') };
}

// --- AC-18901-1: intake --ui writes the record with declaredVia 'intake' --
test('AC-18901-1 happy: an intake run carrying ui with a value from none', async () => {
  for (const value of ['none', 'light', 'central']) {
    const scratch = mkProject();
    await initTree(scratch, { stripSeed: true });
    // Minimal artefact so intake has something to classify.
    const art = join(scratch, 'brief.md');
    await writeFile(art, 'A short product brief for intake.\n', 'utf8');
    const t0 = new Date();
    const r = runCli(['discover', 'intake', '--artefact', art, '--ui', value, '--quiet'], scratch);
    const t1 = new Date();
    assert.equal(r.status, 0, `${value} intake failed: ${r.stderr}`);
    const rec = await readJourneyRecord(scratch);
    assert.ok(rec, `${value}: record must exist after intake`);
    assert.equal(rec.ui, value, `${value}: ui`);
    assert.equal(rec.declaredVia, 'intake', `${value}: declaredVia`);
    assert.ok(typeof rec.declaredAt === 'string' && rec.declaredAt.length > 0,
      `${value}: declaredAt must be a non-empty ISO string`);
    const declared = new Date(rec.declaredAt).valueOf();
    assert.ok(declared >= t0.valueOf() - 2000,
      `${value}: declaredAt (${rec.declaredAt}) must be at or after the run start (${t0.toISOString()})`);
    assert.ok(declared <= t1.valueOf() + 2000,
      `${value}: declaredAt (${rec.declaredAt}) must be at or before the run end (${t1.toISOString()})`);
  }
});

// --- AC-18901-2: declare verb, --as-built, --reason on lowering ------------
test('AC-18901-2 happy: a tree with or without an existing journeyjson', async () => {
  // (a) tree with no record: declare creates it.
  const a = mkProject();
  await initTree(a, { stripSeed: true });
  const ra = runCli(['discover', 'journey', 'declare', '--ui', 'light'], a);
  assert.equal(ra.status, 0, `declare on empty tree failed: ${ra.stderr}`);
  const rec_a = await readJourneyRecord(a);
  assert.equal(rec_a.ui, 'light');
  assert.equal(rec_a.declaredVia, 'declare');
  assert.equal(rec_a.asBuilt, false, 'asBuilt without --as-built defaults false on a fresh record');

  // (b) tree with an existing record (init seed): declare updates it.
  const b = mkProject();
  await initTree(b);
  const rb = runCli(['discover', 'journey', 'declare', '--ui', 'central', '--as-built'], b);
  assert.equal(rb.status, 0, `declare over init seed failed: ${rb.stderr}`);
  const rec_b = await readJourneyRecord(b);
  assert.equal(rec_b.ui, 'central');
  assert.equal(rec_b.declaredVia, 'declare');
  assert.equal(rec_b.asBuilt, true, '--as-built flips asBuilt to true');

  // (c) --as-built absence leaves asBuilt as it was.
  const rc = runCli(['discover', 'journey', 'declare', '--ui', 'central'], b);
  assert.equal(rc.status, 0, `second declare without --as-built failed: ${rc.stderr}`);
  const rec_c = await readJourneyRecord(b);
  assert.equal(rec_c.asBuilt, true, 'omitting --as-built must leave the prior asBuilt in place');

  // (d) lowering central->light WITHOUT --reason is refused with exit 2.
  const r_lower = runCli(['discover', 'journey', 'declare', '--ui', 'light'], b);
  assert.equal(r_lower.status, 2, `lowering without --reason must exit 2 (got ${r_lower.status}; stderr=${r_lower.stderr})`);
  assert.match(r_lower.stderr, /--reason/, 'the error must name the --reason flag');

  // (e) same call with --reason is accepted and records the reason.
  const r_lower_ok = runCli(['discover', 'journey', 'declare', '--ui', 'light', '--reason', 'moved to a light shell'], b);
  assert.equal(r_lower_ok.status, 0, `lowering with --reason failed: ${r_lower_ok.stderr}`);
  const rec_e = await readJourneyRecord(b);
  assert.equal(rec_e.ui, 'light');
  assert.equal(rec_e.declaredReason, 'moved to a light shell');

  // (f) lowering light->none WITHOUT --reason is refused the same way;
  // with --reason it is accepted and the reason lands on the record.
  const r_lower_none_bare = runCli(['discover', 'journey', 'declare', '--ui', 'none'], b);
  assert.equal(r_lower_none_bare.status, 2, `light->none without --reason must exit 2 (got ${r_lower_none_bare.status}; stderr=${r_lower_none_bare.stderr})`);
  const r_lower_none = runCli(['discover', 'journey', 'declare', '--ui', 'none', '--reason', 'the UI was removed'], b);
  assert.equal(r_lower_none.status, 0, `light->none with --reason failed: ${r_lower_none.stderr}`);
  const rec_f = await readJourneyRecord(b);
  assert.equal(rec_f.ui, 'none');
  assert.equal(rec_f.declaredReason, 'the UI was removed');

  // (g) central->none also requires --reason (fresh scratch to isolate).
  const g = mkProject();
  await initTree(g);
  const rg_up = runCli(['discover', 'journey', 'declare', '--ui', 'central'], g);
  assert.equal(rg_up.status, 0, `raise to central failed: ${rg_up.stderr}`);
  const rg_bare = runCli(['discover', 'journey', 'declare', '--ui', 'none'], g);
  assert.equal(rg_bare.status, 2, `central->none without --reason must exit 2`);
  const rg_ok = runCli(['discover', 'journey', 'declare', '--ui', 'none', '--reason', 'back to headless'], g);
  assert.equal(rg_ok.status, 0, `central->none with --reason failed: ${rg_ok.stderr}`);
  const rec_g = await readJourneyRecord(g);
  assert.equal(rec_g.ui, 'none');
  assert.equal(rec_g.declaredReason, 'back to headless');

  // (h) a whitespace-only --reason does NOT satisfy the lowering rule
  // (FBS-211 review F8); exit 2, nothing written.
  const h = mkProject();
  await initTree(h);
  const rh_up = runCli(['discover', 'journey', 'declare', '--ui', 'central'], h);
  assert.equal(rh_up.status, 0, `raise to central failed: ${rh_up.stderr}`);
  const rh_blank = runCli(['discover', 'journey', 'declare', '--ui', 'light', '--reason', '   '], h);
  assert.equal(rh_blank.status, 2, `whitespace --reason must exit 2 (got ${rh_blank.status}; stderr=${rh_blank.stderr})`);
  assert.match(rh_blank.stderr, /--reason/);
  const rec_h = await readJourneyRecord(h);
  assert.equal(rec_h.ui, 'central', 'the lowering was refused, so the prior ui stays');

  // (i) a declare that is NOT a lowering clears a prior declaredReason
  // (FBS-211 review F9); a raise back to central after a lowering must
  // not retain the old reason on the record.
  const i = mkProject();
  await initTree(i);
  runCli(['discover', 'journey', 'declare', '--ui', 'central'], i);
  runCli(['discover', 'journey', 'declare', '--ui', 'light', '--reason', 'temporary step down'], i);
  const rec_before = await readJourneyRecord(i);
  assert.equal(rec_before.declaredReason, 'temporary step down');
  const r_raise = runCli(['discover', 'journey', 'declare', '--ui', 'central', '--as-built'], i);
  assert.equal(r_raise.status, 0, `raise failed: ${r_raise.stderr}`);
  const rec_after = await readJourneyRecord(i);
  assert.equal(rec_after.ui, 'central');
  assert.equal(rec_after.declaredReason, null, 'a non-lowering declare must clear declaredReason');
});

// --- AC-18901-3: interactive intake prints matcher signals + asks ----------
test('AC-18901-3 happy: an interactive intake run with no ui flag', async () => {
  // The CLI is not a TTY under spawnSync, so the main() TTY path is
  // reached by driving promptForUi directly through injected streams
  // that declare isTTY. Two cases per the AC: a signal-bearing text
  // (dashboard/chart) with a typed answer that opposes the proposal,
  // and a no-signal text with a typed answer that opposes 'none'.

  // Case A: signals present (proposal is 'central'); operator types 'none'.
  {
    const scratch = mkProject();
    await initTree(scratch, { stripSeed: true });
    const art = join(scratch, 'brief.md');
    await writeFile(art, 'The dashboard shows a chart over the API response.\n', 'utf8');
    const stdin = new PassThrough();
    stdin.isTTY = true;
    const outCap = captureStream();
    outCap.stream.isTTY = true;
    const typed = 'none\n';
    stdin.write(typed);
    stdin.end();
    const answer = await promptForUi({
      artefactPaths: [art], projectRoot: scratch, stdin, stdout: outCap.stream,
    });
    const out = outCap.text();
    assert.equal(answer, 'none', 'the operator-typed answer wins over the proposal');
    assert.match(out, /UI signals in artefact text: /, 'signals line printed');
    assert.match(out, /dashboard/i, 'the matched text appears (not the regex source)');
    assert.doesNotMatch(out, /shows\?/, 'the regex source "shows?" must not leak into the signals line');
    assert.match(out, /^Proposed: central$/m, 'proposal is central for a dashboard-shape artefact');
  }

  // Case B: no signals (proposal is 'none'); operator types 'central'.
  {
    const scratch = mkProject();
    await initTree(scratch, { stripSeed: true });
    const art = join(scratch, 'brief.md');
    await writeFile(art, 'A back-end batch job that moves files between object stores.\n', 'utf8');
    const stdin = new PassThrough();
    stdin.isTTY = true;
    const outCap = captureStream();
    outCap.stream.isTTY = true;
    stdin.write('central\n');
    stdin.end();
    const answer = await promptForUi({
      artefactPaths: [art], projectRoot: scratch, stdin, stdout: outCap.stream,
    });
    const out = outCap.text();
    assert.equal(answer, 'central', 'the operator-typed answer wins over the "none" proposal');
    assert.match(out, /UI signals in artefact text: \(none\)/, 'no-signals line printed verbatim');
    assert.match(out, /^Proposed: none$/m, 'proposal is none when nothing matched');
  }

  // Case C: operator declaration still wins when a non-interactive
  // run supplies --input with a ui opposing the mechanical signals.
  const scratch = mkProject();
  await initTree(scratch, { stripSeed: true });
  const art = join(scratch, 'brief.md');
  await writeFile(art, 'The dashboard shows a chart over the API response.\n', 'utf8');
  const inputPath = join(scratch, 'intake.input.json');
  await writeFile(inputPath, JSON.stringify({
    fidelity: 'napkin',
    artefacts: [{ path: 'brief.md' }],
    ui: 'none',
  }), 'utf8');
  const r = runCli(['discover', 'intake', '--input', inputPath, '--quiet'], scratch);
  assert.equal(r.status, 0, `intake --input failed: ${r.stderr}`);
  const rec = await readJourneyRecord(scratch);
  assert.equal(rec.ui, 'none', 'operator declaration wins over the mechanical signals');
});

// --- AC-18901-4: --input with no ui exits 2 and writes NOTHING -------------
test('AC-18901-4 failure: a noninteractive intake run through input with n', async () => {
  // Case A: no signals in the artefact. --input without ui still exits 2.
  {
    const scratch = mkProject();
    await initTree(scratch, { stripSeed: true });
    const art = join(scratch, 'brief.md');
    await writeFile(art, 'A short product brief.\n', 'utf8');
    const inputPath = join(scratch, 'intake.input.json');
    await writeFile(inputPath, JSON.stringify({
      fidelity: 'napkin',
      artefacts: [{ path: 'brief.md' }],
      // ui missing on purpose
    }), 'utf8');
    const r = runCli(['discover', 'intake', '--input', inputPath, '--quiet'], scratch);
    assert.equal(r.status, 2, `missing ui must exit 2 (got ${r.status}; stderr=${r.stderr})`);
    assert.match(r.stderr, /\bui\b/i, 'the error must name the ui field');
    assert.equal(await fileExists(join(scratch, JOURNEY_FILE)), false,
      'no journey.json may be written');
    const manifest = JSON.parse(await readFile(join(scratch, 'rcf', 'manifest.json'), 'utf8'));
    assert.equal(manifest.intakeClassification, undefined,
      'no intakeClassification may be written to the manifest');
  }

  // Case B: signal-bearing artefact. The matcher could easily
  // produce a verdict, but with no ui field the gate still refuses
  // and writes nothing. The point of the AC: the CLI is not allowed
  // to infer a declaration from the signals.
  {
    const scratch = mkProject();
    await initTree(scratch, { stripSeed: true });
    const art = join(scratch, 'brief.md');
    await writeFile(art, 'A central admin dashboard with a navigation sidebar and modal layout. The page shows a table.\n', 'utf8');
    const inputPath = join(scratch, 'intake.input.json');
    await writeFile(inputPath, JSON.stringify({
      fidelity: 'napkin',
      artefacts: [{ path: 'brief.md' }],
      // ui missing on purpose
    }), 'utf8');
    const r = runCli(['discover', 'intake', '--input', inputPath, '--quiet'], scratch);
    assert.equal(r.status, 2, `missing ui with a signal-bearing artefact must still exit 2 (got ${r.status}; stderr=${r.stderr})`);
    assert.match(r.stderr, /\bui\b/i, 'the error must name the ui field');
    assert.equal(await fileExists(join(scratch, JOURNEY_FILE)), false,
      'no journey.json may be written even on a UI-shape artefact');
    const manifest = JSON.parse(await readFile(join(scratch, 'rcf', 'manifest.json'), 'utf8'));
    assert.equal(manifest.intakeClassification, undefined,
      'no intakeClassification may be written on this path either');
  }
});

// --- Mixed-source rejection: --input and --ui together exit 2 (F13 fold-in) --
test('AC-18901-Y mixed: --input ui and --ui together exit 2 with nothing written', async () => {
  const scratch = mkProject();
  await initTree(scratch, { stripSeed: true });
  const art = join(scratch, 'brief.md');
  await writeFile(art, 'A short product brief.\n', 'utf8');
  const inputPath = join(scratch, 'intake.input.json');
  await writeFile(inputPath, JSON.stringify({
    fidelity: 'napkin',
    artefacts: [{ path: 'brief.md' }],
    ui: 'light',
  }), 'utf8');
  const r = runCli(['discover', 'intake', '--input', inputPath, '--ui', 'central', '--quiet'], scratch);
  assert.equal(r.status, 2, `mixing --input ui and --ui must exit 2 (got ${r.status}; stderr=${r.stderr})`);
  assert.match(r.stderr, /--ui/, 'the error must name the --ui flag');
  assert.equal(await fileExists(join(scratch, JOURNEY_FILE)), false, 'nothing written on a mixed-source refusal');
});

// --- AC-18901-5: grandfathered state (no file) + dry-run writes nothing + prints the record -----
test('AC-18901-5 edge: a tree with no rcfdiscoveryjourneyjson', async () => {
  const scratch = mkProject();
  await initTree(scratch, { stripSeed: true });
  // readJourneyRecord returns null for a tree with no record.
  const rec = await readJourneyRecord(scratch);
  assert.equal(rec, null, 'no record means null, not an empty record');

  // discover intake --dry-run prints the plan AND the full JourneyRecord
  // it would write; nothing lands on disk.
  const art = join(scratch, 'brief.md');
  await writeFile(art, 'A short brief for the dry-run.\n', 'utf8');
  const r_intake = runCli(['discover', 'intake', '--artefact', art, '--ui', 'light', '--dry-run'], scratch);
  assert.equal(r_intake.status, 0, `intake --dry-run failed: ${r_intake.stderr}`);
  assert.match(r_intake.stdout, /\[dry-run\] would write rcf\/discovery\/journey.json:/,
    'dry-run must name the journey.json path');
  assert.match(r_intake.stdout, /"ui": "light"/, 'dry-run text must carry the full JourneyRecord bytes');
  assert.match(r_intake.stdout, /"declaredVia": "intake"/, 'dry-run text must carry declaredVia intake');
  assert.equal(await fileExists(join(scratch, JOURNEY_FILE)), false,
    'intake --dry-run must not write journey.json');
  const manifestAfterIntakeDry = JSON.parse(await readFile(join(scratch, 'rcf', 'manifest.json'), 'utf8'));
  assert.equal(manifestAfterIntakeDry.intakeClassification, undefined,
    'intake --dry-run must not write the intakeClassification either');

  // intake --dry-run --json carries the composed JourneyRecord under journeyRecord.
  const r_intake_json = runCli(['discover', 'intake', '--artefact', art, '--ui', 'light', '--dry-run', '--json'], scratch);
  assert.equal(r_intake_json.status, 0, `intake --dry-run --json failed: ${r_intake_json.stderr}`);
  const envJson = JSON.parse(r_intake_json.stdout);
  assert.equal(envJson.verb, 'intake');
  assert.equal(envJson.dryRun, true);
  assert.ok(envJson.journeyRecord, '--json dry-run envelope must carry the journey record');
  assert.equal(envJson.journeyRecord.ui, 'light');
  assert.equal(envJson.journeyRecord.declaredVia, 'intake');

  // discover journey declare --dry-run same: prints the full record,
  // writes nothing.
  const r_declare = runCli(['discover', 'journey', 'declare', '--ui', 'central', '--dry-run'], scratch);
  assert.equal(r_declare.status, 0, `declare --dry-run failed: ${r_declare.stderr}`);
  assert.match(r_declare.stdout, /\[dry-run\] would write rcf\/discovery\/journey.json:/,
    'declare --dry-run text must name the journey.json path');
  assert.match(r_declare.stdout, /"ui": "central"/, 'declare --dry-run text must carry the full record');
  assert.equal(await fileExists(join(scratch, JOURNEY_FILE)), false,
    'journey declare --dry-run must not write journey.json');
  assert.equal(await fileExists(join(scratch, 'rcf', 'discovery')), false,
    'rcf/discovery/ must stay absent on a dry run');

  // declare --dry-run --json carries the composed JourneyRecord too.
  const r_declare_json = runCli(['discover', 'journey', 'declare', '--ui', 'central', '--dry-run', '--json'], scratch);
  assert.equal(r_declare_json.status, 0, `declare --dry-run --json failed: ${r_declare_json.stderr}`);
  const declareEnv = JSON.parse(r_declare_json.stdout);
  assert.equal(declareEnv.verb, 'declare');
  assert.equal(declareEnv.dryRun, true);
  assert.ok(declareEnv.journeyRecord, '--json declare dry-run must carry the journey record');
  assert.equal(declareEnv.journeyRecord.ui, 'central');
  assert.equal(declareEnv.journeyRecord.declaredVia, 'declare');
});

// --- AC-18901-6: init seeds the record ------------------------------------
test('AC-18901-6 edge: rcf init on this version', async () => {
  const scratch = mkProject();
  await initTree(scratch); // DO NOT strip the seed
  const rec = await readJourneyRecord(scratch);
  assert.ok(rec, 'init must seed journey.json');
  assert.equal(rec.ui, null, 'ui starts null until declared');
  assert.equal(rec.declaredVia, 'init');
  assert.equal(rec.asBuilt, false);
  assert.ok(typeof rec.declaredAt === 'string' && rec.declaredAt.length > 0,
    'declaredAt is a timestamp of the init run');
});

// --- Backward-compatibility: a main-shape record (no declaredReason) reads clean --
test('AC-18901-X back-compat: a FBS-210 shape record (no declaredReason) reads, declares, and intakes', async () => {
  // FBS-211 review F1: a record written by main at e2a80f08 does not
  // carry declaredReason; readJourneyRecord must treat the absent
  // field as null (grandfathering the pre-FBS-211 shape), and the
  // show / declare / intake verbs must all handle such a record.
  const scratch = mkProject();
  await initTree(scratch, { stripSeed: true });
  // Author a journey.json by hand in the pre-FBS-211 shape.
  await mkdir(join(scratch, 'rcf', 'discovery'), { recursive: true });
  const mainShape = {
    version: 1,
    ui: null,
    declaredAt: null,
    declaredBy: null,
    declaredVia: null,
    asBuilt: false,
    screens: [],
    journeys: [],
    review: null,
  };
  await writeFile(join(scratch, JOURNEY_FILE), `${JSON.stringify(mainShape, null, 2)}\n`, 'utf8');

  // readJourneyRecord returns the record with declaredReason normalised to null.
  const rec = await readJourneyRecord(scratch);
  assert.ok(rec, 'main-shape record must read');
  assert.equal(rec.declaredReason, null, 'absent declaredReason reads as null');

  // show exits 0 and does not crash on the main-shape file.
  const r_show = runCli(['discover', 'journey', 'show'], scratch);
  assert.equal(r_show.status, 0, `show must handle a main-shape record (got ${r_show.status}; stderr=${r_show.stderr})`);

  // declare exits 0 and lands a well-formed record (declaredReason stays null, no lowering).
  const r_declare = runCli(['discover', 'journey', 'declare', '--ui', 'light'], scratch);
  assert.equal(r_declare.status, 0, `declare must handle a main-shape record (got ${r_declare.status}; stderr=${r_declare.stderr})`);
  const after_declare = await readJourneyRecord(scratch);
  assert.equal(after_declare.ui, 'light');
  assert.equal(after_declare.declaredReason, null);

  // intake over a main-shape record likewise exits 0 and reshapes to a FBS-211 record.
  const scratch2 = mkProject();
  await initTree(scratch2, { stripSeed: true });
  await mkdir(join(scratch2, 'rcf', 'discovery'), { recursive: true });
  await writeFile(join(scratch2, JOURNEY_FILE), `${JSON.stringify(mainShape, null, 2)}\n`, 'utf8');
  const art = join(scratch2, 'brief.md');
  await writeFile(art, 'A short brief.\n', 'utf8');
  const r_intake = runCli(['discover', 'intake', '--artefact', art, '--ui', 'none', '--quiet'], scratch2);
  assert.equal(r_intake.status, 0, `intake must handle a main-shape record (got ${r_intake.status}; stderr=${r_intake.stderr})`);
  const after_intake = await readJourneyRecord(scratch2);
  assert.equal(after_intake.ui, 'none');
  assert.equal(after_intake.declaredReason, null);
});

// --- AC-18901-7: doctor notice, never drift, never written by --fix --------
test('AC-18901-7 must-not: a tree with no journeyjson', async () => {
  const scratch = mkProject();
  await initTree(scratch, { stripSeed: true });
  // --json so the notice and the exit code can both be inspected.
  const r = runCli(['doctor', '--json'], scratch);
  const envNoSeed = JSON.parse(r.stdout);
  assert.ok(Array.isArray(envNoSeed.notices));
  const hasSlug = envNoSeed.notices.some((n) => typeof n === 'string' && n.includes('discovery-declaration-missing'));
  assert.ok(hasSlug, `the discovery-declaration-missing notice must appear in notices; got ${JSON.stringify(envNoSeed.notices)}`);
  const inDrift = (envNoSeed.drift ?? []).some((d) => (d.check && d.check.includes('discovery')) || (d.item && d.item.includes('discovery-declaration-missing')));
  assert.equal(inDrift, false, 'the missing record must never appear under drift');

  // --fix must never write the record, and must never add drift or
  // flip the exit code because of this slug (FBS-211 review F12).
  assert.equal(await fileExists(join(scratch, JOURNEY_FILE)), false, 'baseline: file absent');
  const rfix = runCli(['doctor', '--fix', '--json'], scratch);
  assert.equal(await fileExists(join(scratch, JOURNEY_FILE)), false,
    '--fix must never write rcf/discovery/journey.json');
  const envFix = JSON.parse(rfix.stdout);
  assert.ok(Array.isArray(envFix.notices));
  assert.ok(envFix.notices.some((n) => typeof n === 'string' && n.includes('discovery-declaration-missing')),
    '--fix must leave the discovery-declaration-missing notice in place');
  const fixDrift = (envFix.drift ?? []).some((d) => (d.check && d.check.includes('discovery')) || (d.item && d.item.includes('discovery-declaration-missing')));
  assert.equal(fixDrift, false, '--fix must never surface this slug under drift');
  assert.equal(rfix.status, r.status, '--fix must leave the exit code unchanged for this slug');
  const writesForJourney = Array.isArray(envFix.writes) ? envFix.writes.filter((w) => w && (w.file || '').includes('discovery')) : [];
  assert.equal(writesForJourney.length, 0, '--fix must never record a write for the discovery journey');

  // Exit-code invariance: run doctor once with the record present and
  // once without; the slug flips in notices, the exit code does not.
  const scratch2 = mkProject();
  await initTree(scratch2); // seed present
  const r_with = runCli(['doctor', '--json'], scratch2);
  const env_with = JSON.parse(r_with.stdout);
  const hasSlug2 = (env_with.notices ?? []).some((n) => typeof n === 'string' && n.includes('discovery-declaration-missing'));
  assert.equal(hasSlug2, false, 'the slug must be absent when the record is present');
  assert.equal(r.status, r_with.status,
    `exit code must be unchanged by the discovery-declaration-missing notice (${r.status} vs ${r_with.status})`);
});
