// REQ-189 US-18901 (UX intake gate): seven real tests binding the
// seven acceptance criteria of US-18901 to the FBS-211 implementation.
// Each AC test name is kept verbatim from the DEFINE declaration so
// the testPointer on TC-243-18901-* resolves unchanged; the todo flag
// and placeholder bodies from the DEFINE scaffold are replaced with
// real coverage. Node 24 built-ins only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { readFile, writeFile, mkdir, stat, unlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { initProject } from '#core/store/init.js';
import {
  JOURNEY_FILE,
  readJourneyRecord,
} from '../../src/discovery/record.js';

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
    assert.equal(r.status, 0, `${value} intake failed: ${r.stderr}`);
    const rec = await readJourneyRecord(scratch);
    assert.ok(rec, `${value}: record must exist after intake`);
    assert.equal(rec.ui, value, `${value}: ui`);
    assert.equal(rec.declaredVia, 'intake', `${value}: declaredVia`);
    assert.ok(typeof rec.declaredAt === 'string' && rec.declaredAt.length > 0,
      `${value}: declaredAt must be a non-empty ISO string`);
    assert.ok(new Date(rec.declaredAt).valueOf() >= t0.valueOf() - 2000,
      `${value}: declaredAt (${rec.declaredAt}) must be close to the run time (${t0.toISOString()})`);
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
});

// --- AC-18901-3: interactive intake prints matcher signals + asks ----------
test('AC-18901-3 happy: an interactive intake run with no ui flag', async () => {
  // The CLI is not a TTY under spawnSync. The AC targets the matcher-prints
  // -over-artefact-text invariant plus "the value written is the one the
  // operator typed, never the proposal". We exercise the invariant through
  // --input (deterministic, no TTY) with a declared ui that opposes the
  // artefact signals, and also prove matchUiSignals runs over the artefact
  // in the non-interactive proposal path via its public signal list.
  const scratch = mkProject();
  await initTree(scratch, { stripSeed: true });
  const art = join(scratch, 'brief.md');
  await writeFile(art, 'The dashboard shows a chart over the API response.\n', 'utf8');
  // Operator declares none even though the artefact mentions dashboard/chart,
  // which the matcher flags as UI signals. The written ui must be the
  // operator's answer (none), never the proposal.
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
  // Matcher is accessible and reports UI signals on the artefact text, so
  // the interactive promptForUi has the material to render.
  const { matchUiSignals } = await import('../../src/core/patterns/ui-shapes.js');
  const sigs = matchUiSignals('The dashboard shows a chart over the API response.');
  assert.ok(sigs.length > 0, 'matchUiSignals must find at least one signal on this artefact text');
});

// --- AC-18901-4: --input with no ui exits 2 and writes NOTHING -------------
test('AC-18901-4 failure: a noninteractive intake run through input with n', async () => {
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
  // Nothing was written: no journey.json, no intakeClassification.
  assert.equal(await fileExists(join(scratch, JOURNEY_FILE)), false,
    'no journey.json may be written');
  const manifest = JSON.parse(await readFile(join(scratch, 'rcf', 'manifest.json'), 'utf8'));
  assert.equal(manifest.intakeClassification, undefined,
    'no intakeClassification may be written to the manifest');
});

// --- AC-18901-5: grandfathered state (no file) + dry-run writes nothing -----
test('AC-18901-5 edge: a tree with no rcfdiscoveryjourneyjson', async () => {
  const scratch = mkProject();
  await initTree(scratch, { stripSeed: true });
  // readJourneyRecord returns null for a tree with no record.
  const rec = await readJourneyRecord(scratch);
  assert.equal(rec, null, 'no record means null, not an empty record');

  // discover intake --dry-run prints the plan and writes nothing.
  const art = join(scratch, 'brief.md');
  await writeFile(art, 'A short brief for the dry-run.\n', 'utf8');
  const r_intake = runCli(['discover', 'intake', '--artefact', art, '--ui', 'light', '--dry-run'], scratch);
  assert.equal(r_intake.status, 0, `intake --dry-run failed: ${r_intake.stderr}`);
  assert.equal(await fileExists(join(scratch, JOURNEY_FILE)), false,
    'intake --dry-run must not write journey.json');
  const manifestAfterIntakeDry = JSON.parse(await readFile(join(scratch, 'rcf', 'manifest.json'), 'utf8'));
  assert.equal(manifestAfterIntakeDry.intakeClassification, undefined,
    'intake --dry-run must not write the intakeClassification either');

  // discover journey declare --dry-run same.
  const r_declare = runCli(['discover', 'journey', 'declare', '--ui', 'central', '--dry-run'], scratch);
  assert.equal(r_declare.status, 0, `declare --dry-run failed: ${r_declare.stderr}`);
  assert.equal(await fileExists(join(scratch, JOURNEY_FILE)), false,
    'journey declare --dry-run must not write journey.json');
  // Discovery subtree stays absent.
  assert.equal(await fileExists(join(scratch, 'rcf', 'discovery')), false,
    'rcf/discovery/ must stay absent on a dry run');
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

// --- AC-18901-7: doctor notice, never drift, never written by --fix --------
test('AC-18901-7 must-not: a tree with no journeyjson', async () => {
  const scratch = mkProject();
  await initTree(scratch, { stripSeed: true });
  // --json so the notice and the exit code can both be inspected.
  const r = runCli(['doctor', '--json'], scratch);
  // Exit code may be 0 or 3 depending on OTHER drift on a fresh tree; the
  // AC says the exit code must be UNCHANGED by this notice. We run the
  // same command once without the record and once with it, then compare.
  const envNoSeed = JSON.parse(r.stdout);
  assert.ok(Array.isArray(envNoSeed.notices));
  const hasSlug = envNoSeed.notices.some((n) => typeof n === 'string' && n.includes('discovery-declaration-missing'));
  assert.ok(hasSlug, `the discovery-declaration-missing notice must appear in notices; got ${JSON.stringify(envNoSeed.notices)}`);
  const inDrift = (envNoSeed.drift ?? []).some((d) => (d.check && d.check.includes('discovery')) || (d.item && d.item.includes('discovery-declaration-missing')));
  assert.equal(inDrift, false, 'the missing record must never appear under drift');

  // --fix must never write the record.
  assert.equal(await fileExists(join(scratch, JOURNEY_FILE)), false, 'baseline: file absent');
  const rfix = runCli(['doctor', '--fix', '--json'], scratch);
  assert.equal(await fileExists(join(scratch, JOURNEY_FILE)), false,
    '--fix must never write rcf/discovery/journey.json');

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
  // --fix idempotence on the slug: neither run writes journey.json.
  void rfix;
});
