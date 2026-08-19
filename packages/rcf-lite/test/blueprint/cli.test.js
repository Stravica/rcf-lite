// CLI-level tests for `rcf blueprint` and `rcf standards`. Covers
// AC-1001-5 (top-level help advertises blueprint), CLI wiring, and
// exit codes on refused conflicts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { initProject } from '#core/store';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, '..', '..', 'bin', 'rcf.js');

async function runBin(cwd, args) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [bin, ...args], {
      cwd, encoding: 'utf8', env: { ...process.env, CI: '1' },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

async function scaffold() {
  const root = await mkdtemp(join(tmpdir(), 'rcf-bp-cli-'));
  const init = await initProject({ projectRoot: root, projectName: 'CliBP' });
  assert.equal(init.kind, undefined);
  return root;
}

test('rcf --help advertises `blueprint` and `standards` as top-level commands (AC-1001-5)', async () => {
  const root = await scaffold();
  const { code, stdout } = await runBin(root, ['--help']);
  assert.equal(code, 0);
  assert.match(stdout, /blueprint <verb>/);
  assert.match(stdout, /standards <verb>/);
});

test('rcf help blueprint prints the blueprint HELP block', async () => {
  const root = await scaffold();
  const { code, stdout } = await runBin(root, ['help', 'blueprint']);
  assert.equal(code, 0);
  assert.match(stdout, /Usage: rcf blueprint <verb>/);
  assert.match(stdout, /add <source>/);
  assert.match(stdout, /remove <slug>/);
});

test('rcf blueprint list on a fresh project prints the no-blueprints notice and exits 0', async () => {
  const root = await scaffold();
  const { code, stdout } = await runBin(root, ['blueprint', 'list']);
  assert.equal(code, 0);
  assert.match(stdout, /no blueprints applied/);
});

test('rcf standards list on a fresh project prints the no-standards notice and exits 0', async () => {
  const root = await scaffold();
  const { code, stdout } = await runBin(root, ['standards', 'list']);
  assert.equal(code, 0);
  assert.match(stdout, /no standards packs registered/);
});

test('rcf blueprint add + list end-to-end via the CLI', async () => {
  const root = await scaffold();
  const bpDir = join(root, 'blueprint-alpha');
  await mkdir(join(bpDir, 'contributions'), { recursive: true });
  await writeFile(join(bpDir, 'blueprint.json'), JSON.stringify({
    slug: 'alpha', version: '1.0.0',
    contributions: [{ kind: 'req', id: 'alpha-REQ-001', path: 'alpha-req-001.json' }],
  }, null, 2), 'utf8');
  await writeFile(join(bpDir, 'contributions', 'alpha-req-001.json'), JSON.stringify({
    reqId: 'alpha-REQ-001', prdId: 'PRD-001',
    title: 'x', description: 'y', category: 'functional', priority: 'must', domain: 'ui',
    version: '0.1.0', status: 'draft',
    createdAt: '2026-08-19T00:00:00Z', updatedAt: '2026-08-19T00:00:00Z',
  }, null, 2), 'utf8');
  const addResult = await runBin(root, ['blueprint', 'add', bpDir]);
  assert.equal(addResult.code, 0, `add stderr: ${addResult.stderr}`);
  assert.match(addResult.stdout, /applied 'alpha' at 1\.0\.0/);
  const listResult = await runBin(root, ['blueprint', 'list']);
  assert.equal(listResult.code, 0);
  assert.match(listResult.stdout, /^alpha\t1\.0\.0/m);
});

// ---------------------------------------------------------------------------
// w-2026-08-19-001: prefix-family id derivation (rcf-schemas 0.4.4 grammar).
//
// Blueprint apply stamps a prefix-family id like `spa-REQ-001` and writes
// the contribution to `rcf/requirements/spa-req-001.json`. Pre-fix the
// walker's `idFromFilenameStem` split on the first hyphen and upper-cased
// the leading segment only -- `spa-req-001` derived as `SPA-req-001`,
// which then failed to resolve through `pathForId` (no `SPA-` /
// `spa-REQ-` case in the startsWith ladder), so a subsequent walk
// surfaced `Unrecognised document id: SPA-req-001` and `rcf validate`
// exited non-zero on a freshly-added prefix-family contribution.
//
// The fix routes both `idFromFilenameStem` (walker) and `pathForId`
// (loader) through the shared `parseIdParts` seat, which already knows
// the two 0.4.4 families (prefix REQ/US/PRD/BS/TAD/TS; suffix
// ADR/TAC/FBS/CN). Regression is a CLI-level round-trip: apply → walk
// clean → re-add idempotent → remove clean.
// ---------------------------------------------------------------------------
test('rcf blueprint add + validate round-trip for a prefix-family (slug-prefixed) contribution (w-2026-08-19-001)', async () => {
  const root = await scaffold();
  const bpDir = join(root, 'blueprint-spa');
  await mkdir(join(bpDir, 'contributions'), { recursive: true });
  await writeFile(join(bpDir, 'blueprint.json'), JSON.stringify({
    slug: 'spa', version: '0.1.0',
    contributions: [
      // Prefix-family: slug attaches as a lowercase prefix, e.g. spa-REQ-001.
      { kind: 'req', id: 'spa-REQ-001', path: 'spa-req-001.json' },
      { kind: 'us',  id: 'spa-US-101', path: 'spa-us-101.json' },
    ],
  }, null, 2), 'utf8');
  await writeFile(join(bpDir, 'contributions', 'spa-req-001.json'), JSON.stringify({
    reqId: 'spa-REQ-001', prdId: 'PRD-001',
    title: 'SPA prefix-family REQ',
    description: 'Round-trips a prefix-namespaced req through walker + loader.',
    category: 'functional', priority: 'must', domain: 'ui',
    version: '0.1.0', status: 'draft',
    createdAt: '2026-08-19T00:00:00Z', updatedAt: '2026-08-19T00:00:00Z',
  }, null, 2), 'utf8');
  await writeFile(join(bpDir, 'contributions', 'spa-us-101.json'), JSON.stringify({
    usId: 'spa-US-101', prdId: 'PRD-001', reqId: 'spa-REQ-001',
    version: '0.1.0', status: 'draft',
    title: 'SPA prefix-family US',
    description: 'Prefix-family user story bound to a prefix-family REQ.',
    asA: 'developer',
    iWant: 'prefix-family ids to round-trip cleanly through walker and loader',
    soThat: 'blueprint add of a prefix-family contribution is not broken',
    acceptanceCriteria: [{
      id: 'AC-999-1',
      description: 'The walker keys the added doc under spa-US-101',
      given: 'a prefix-family US on disk under spa-us-101.json',
      when: 'the walker derives an id from the filename stem',
      then: 'it derives spa-US-101 and pathForId resolves the id back to the file',
      testable: true,
    }],
    tacIds: [],
    createdAt: '2026-08-19T00:00:00Z', updatedAt: '2026-08-19T00:00:00Z',
  }, null, 2), 'utf8');

  // First apply -- must succeed.
  const first = await runBin(root, ['blueprint', 'add', bpDir]);
  assert.equal(first.code, 0, `first add stderr: ${first.stderr}\nstdout: ${first.stdout}`);
  assert.match(first.stdout, /applied 'spa' at 0\.1\.0/);

  // Pre-fix, `rcf validate` surfaced two `Unrecognised document id`
  // errors here (SPA-req-001, SPA-us-101) and exited non-zero. The fix
  // is proven by a clean exit + zero error output on the fresh tree.
  const validateAfterAdd = await runBin(root, ['validate']);
  assert.equal(validateAfterAdd.code, 0,
    `validate after add should exit 0.\nstdout: ${validateAfterAdd.stdout}\nstderr: ${validateAfterAdd.stderr}`);
  assert.doesNotMatch(validateAfterAdd.stderr, /Unrecognised document id/,
    `validate leaked an Unrecognised-id error: ${validateAfterAdd.stderr}`);

  // Idempotent re-apply of the same version is a no-op that MUST NOT
  // return a conflict or an error.
  const second = await runBin(root, ['blueprint', 'add', bpDir]);
  assert.equal(second.code, 0, `re-add stderr: ${second.stderr}\nstdout: ${second.stdout}`);

  // Validate must stay clean after the idempotent re-apply.
  const validateAfterReadd = await runBin(root, ['validate']);
  assert.equal(validateAfterReadd.code, 0,
    `validate after re-add should exit 0.\nstdout: ${validateAfterReadd.stdout}\nstderr: ${validateAfterReadd.stderr}`);

  // Remove leaves a clean tree.
  const remove = await runBin(root, ['blueprint', 'remove', 'spa']);
  assert.equal(remove.code, 0, `remove stderr: ${remove.stderr}\nstdout: ${remove.stdout}`);
  const validateAfterRemove = await runBin(root, ['validate']);
  assert.equal(validateAfterRemove.code, 0,
    `validate after remove should exit 0.\nstdout: ${validateAfterRemove.stdout}\nstderr: ${validateAfterRemove.stderr}`);
});

// ---------------------------------------------------------------------------
// Phase 3.5 (w-2026-08-19-008): conflict-resolution verbs at the CLI edge.
// ---------------------------------------------------------------------------

async function writeGlobalAdrBlueprint(root, dirName, { slug, adrId, title, decision, topic = 'auth' }) {
  const dir = join(root, dirName);
  await mkdir(join(dir, 'contributions'), { recursive: true });
  await writeFile(join(dir, 'blueprint.json'), JSON.stringify({
    slug, version: '1.0.0',
    contributions: [{ id: adrId, kind: 'adr', path: `${adrId.toLowerCase()}.json`, scope: 'global', topic }],
  }, null, 2), 'utf8');
  await writeFile(join(dir, 'contributions', `${adrId.toLowerCase()}.json`), JSON.stringify({
    adrId, prdId: 'PRD-001', tadId: 'TAD-001', version: '1.0.0', status: 'accepted',
    title, context: 'test context', decision, consequences: 'test consequences',
    createdAt: '2026-08-19T00:00:00Z', updatedAt: '2026-08-19T00:00:00Z',
  }, null, 2), 'utf8');
  return dir;
}

test('rcf blueprint add --resolve records a resolution and unblocks a would-be conflict', async () => {
  const root = await scaffold();
  const spa  = await writeGlobalAdrBlueprint(root, 'bp-spa',  { slug: 'spa',  adrId: 'ADR-005-spa',  title: 'SPA auth',  decision: 'HttpOnly cookies.' });
  const rest = await writeGlobalAdrBlueprint(root, 'bp-rest', { slug: 'rest', adrId: 'ADR-003-rest', title: 'REST auth', decision: 'JWT bearer.' });

  const addSpa = await runBin(root, ['blueprint', 'add', spa]);
  assert.equal(addSpa.code, 0, `spa add stderr: ${addSpa.stderr}`);

  // Without --resolve: expect exit 3 (conflict) and the reshaped message.
  const addRestConflict = await runBin(root, ['blueprint', 'add', rest]);
  assert.equal(addRestConflict.code, 3, `expected conflict exit 3, got ${addRestConflict.code} stderr: ${addRestConflict.stderr}`);
  assert.match(addRestConflict.stderr, /conflict on topic \(auth\)/);
  assert.match(addRestConflict.stderr, /blueprint spa: SPA auth/);
  assert.match(addRestConflict.stderr, /rcf blueprint supersede auth/);

  // With --resolve: exit 0, apply succeeds, resolution recorded.
  const addRestResolved = await runBin(root, ['blueprint', 'add', rest, '--resolve', 'auth=project:ADR-042']);
  assert.equal(addRestResolved.code, 0, `resolved add stderr: ${addRestResolved.stderr}\nstdout: ${addRestResolved.stdout}`);
  assert.match(addRestResolved.stdout, /applied 'rest'/);
  const manifest = JSON.parse(await (await import('node:fs/promises')).readFile(join(root, 'rcf', 'manifest.json'), 'utf8'));
  assert.equal(manifest.resolutions.length, 1);
  assert.equal(manifest.resolutions[0].topic, 'auth');
  assert.equal(manifest.resolutions[0].resolvedByAdrId, 'ADR-042');
});

test('rcf blueprint add --json emits a machine-readable conflict report on refuse and a success record on apply', async () => {
  const root = await scaffold();
  const spa  = await writeGlobalAdrBlueprint(root, 'bp-spa',  { slug: 'spa',  adrId: 'ADR-005-spa',  title: 'SPA',  decision: 'A.' });
  const rest = await writeGlobalAdrBlueprint(root, 'bp-rest', { slug: 'rest', adrId: 'ADR-003-rest', title: 'REST', decision: 'B.' });
  await runBin(root, ['blueprint', 'add', spa]);

  const conflict = await runBin(root, ['blueprint', 'add', rest, '--json']);
  assert.equal(conflict.code, 3);
  const parsed = JSON.parse(conflict.stdout);
  assert.equal(parsed.refused, true);
  assert.equal(parsed.conflictCount, 1);
  assert.equal(parsed.conflicts[0].kind, 'globalAdrTopic');
  assert.equal(parsed.conflicts[0].topic, 'auth');
  // Four resolution ids, actual slugs filled in.
  const ids = parsed.conflicts[0].resolutions.map((r) => r.id).sort();
  assert.deepEqual(ids, ['adoptIncoming', 'declareOnAdd', 'keepExisting', 'supersede']);

  const ok = await runBin(root, ['blueprint', 'add', rest, '--resolve', 'auth=project:ADR-042', '--json']);
  assert.equal(ok.code, 0);
  const okParsed = JSON.parse(ok.stdout);
  assert.equal(okParsed.refused, false);
  assert.equal(okParsed.applied, true);
  assert.equal(okParsed.slug, 'rest');
});

test('rcf blueprint supersede scaffolds a project ADR and prints the resolution id', async () => {
  const root = await scaffold();
  const spa  = await writeGlobalAdrBlueprint(root, 'bp-spa',  { slug: 'spa',  adrId: 'ADR-005-spa',  title: 'SPA',  decision: 'A.' });
  const rest = await writeGlobalAdrBlueprint(root, 'bp-rest', { slug: 'rest', adrId: 'ADR-003-rest', title: 'REST', decision: 'B.' });
  await runBin(root, ['blueprint', 'add', spa]);
  await runBin(root, ['blueprint', 'add', rest, '--resolve', 'auth=project:ADR-999']);

  const sup = await runBin(root, ['blueprint', 'supersede', 'auth']);
  assert.equal(sup.code, 0, `supersede stderr: ${sup.stderr}\nstdout: ${sup.stdout}`);
  assert.match(sup.stdout, /superseded topic 'auth' via ADR-\d{3}-auth/);
  assert.match(sup.stdout, /resolution recorded as res-\d{4}-\d{2}-\d{2}-\d{3}/);
});

test('rcf blueprint diff auth prints one block per applied global ADR on the topic', async () => {
  const root = await scaffold();
  const spa  = await writeGlobalAdrBlueprint(root, 'bp-spa',  { slug: 'spa',  adrId: 'ADR-005-spa',  title: 'SPA auth heading',  decision: 'HttpOnly cookies.' });
  const rest = await writeGlobalAdrBlueprint(root, 'bp-rest', { slug: 'rest', adrId: 'ADR-003-rest', title: 'REST auth heading', decision: 'JWT bearer.' });
  await runBin(root, ['blueprint', 'add', spa]);
  await runBin(root, ['blueprint', 'add', rest, '--resolve', 'auth=project:ADR-999']);

  const diff = await runBin(root, ['blueprint', 'diff', 'auth']);
  assert.equal(diff.code, 0);
  assert.match(diff.stdout, /blueprint diff on topic \(auth\): 2 scope:global ADR/);
  assert.match(diff.stdout, /\[1\] blueprint spa/);
  assert.match(diff.stdout, /title:\s+SPA auth heading/);
  assert.match(diff.stdout, /\[2\] blueprint rest/);
  assert.match(diff.stdout, /decision:\s+JWT bearer\./);
});

test('rcf blueprint add --resolve rejects a whitespace-only topic and a mis-shaped resolvedByAdrId', async () => {
  const root = await scaffold();
  const rest = await writeGlobalAdrBlueprint(root, 'bp-rest', { slug: 'rest', adrId: 'ADR-003-rest', title: 'x', decision: 'y.' });
  const bad1 = await runBin(root, ['blueprint', 'add', rest, '--resolve', '=project:ADR-042']);
  assert.equal(bad1.code, 2);
  assert.match(bad1.stderr, /--resolve expects a topic before '='/);

  const bad2 = await runBin(root, ['blueprint', 'add', rest, '--resolve', 'auth=project:notAnAdrId']);
  assert.equal(bad2.code, 2);
  assert.match(bad2.stderr, /resolvedByAdrId 'notAnAdrId' is not a well-formed ADR id/);
});

// ---------------------------------------------------------------------------
// HQ round-2 review findings (w-2026-08-19-008 rev-2):
//   P1-1: supersede accepts camelCase topics (shipped SPA + REST are
//         camelCase — authModel, errorEnvelope); option 3 as printed
//         is executable end-to-end against the shipped blueprints.
//   P1-2: --reason on `add` is wired end-to-end.
//   P3-a: --resolve validation error carries no double 'blueprint add:'
//         prefix.
//   P3-b: duplicate --resolve for the same topic dedupes with a warn.
//   Nit:  conflict enrichment is symmetric (incoming side gets title
//         + decision read from the blueprint's ADR file on disk).
// ---------------------------------------------------------------------------

import { readFile as _readFile } from 'node:fs/promises';
import { resolve as _resolveP } from 'node:path';

// The shipped SPA + REST blueprints live in the repo root's blueprints/
// tree (../../../blueprints/spa, ../../../blueprints/rest relative to
// packages/rcf-lite/test/blueprint/). Use them verbatim; this is the
// probe HQ round-2 will re-run.
const shippedSpa  = _resolveP(here, '..', '..', '..', '..', 'blueprints', 'spa');
const shippedRest = _resolveP(here, '..', '..', '..', '..', 'blueprints', 'rest');

test('shipped SPA + REST: option 3 (supersede + re-add) as printed by the reshaped message is executable end-to-end (rev-2 P1-1)', async () => {
  const root = await scaffold();

  // 1. add spa.
  const addSpa = await runBin(root, ['blueprint', 'add', shippedSpa]);
  assert.equal(addSpa.code, 0, `spa add: ${addSpa.stderr}`);

  // 2. add rest -> conflict (authModel is on both, camelCase).
  const conflict = await runBin(root, ['blueprint', 'add', shippedRest]);
  assert.equal(conflict.code, 3);
  // Reshaped header prints the raw camelCase topic in parens.
  assert.match(conflict.stderr, /conflict on topic \(authModel\)/);
  // Option 3 tells the operator to run `rcf blueprint supersede authModel`.
  assert.match(conflict.stderr, /rcf blueprint supersede authModel/);

  // 3. Run supersede EXACTLY as printed (was `exit 2 not a valid kebab slug`
  //    on round-1). Supersede scans applied blueprints for the topic;
  //    only spa is applied yet, so we first stand rest up via --resolve
  //    against a placeholder so supersede has both sides.
  const restViaResolve = await runBin(root, [
    'blueprint', 'add', shippedRest,
    '--resolve', 'authModel=project:ADR-999',
    '--resolve', 'errorEnvelope=project:ADR-999',
  ]);
  assert.equal(restViaResolve.code, 0, `rest via --resolve: ${restViaResolve.stderr}\n${restViaResolve.stdout}`);

  // Now run supersede as printed by the message — no --reason, no
  // ceremony. camelCase topic must be honoured.
  const sup = await runBin(root, ['blueprint', 'supersede', 'authModel']);
  assert.equal(sup.code, 0, `supersede authModel: ${sup.stderr}\n${sup.stdout}`);
  // The scaffolded project ADR id carries a kebab-ified slug tail
  // (adrId grammar requires lowercase kebab after the digits).
  assert.match(sup.stdout, /via ADR-\d{3}-auth-model at rcf\/adrs\/adr-\d{3}-auth-model\.json/);
  assert.match(sup.stdout, /resolution recorded as res-\d{4}-\d{2}-\d{2}-\d{3}/);

  // The persisted resolution record carries the topic verbatim
  // (camelCase), not the kebab-ified derivative.
  const manifest = JSON.parse(await _readFile(join(root, 'rcf', 'manifest.json'), 'utf8'));
  const supersedeRec = manifest.resolutions.find((r) => r.topic === 'authModel' && /^ADR-\d{3}-auth-model$/.test(r.resolvedByAdrId));
  assert.ok(supersedeRec, `expected a supersede-minted resolution with topic 'authModel' and adr-\\d+-auth-model resolvedByAdrId; got ${JSON.stringify(manifest.resolutions)}`);
});

test('rcf blueprint add --reason: reason lands on every resolution record (rev-2 P1-2)', async () => {
  const root = await scaffold();
  const spa  = await writeGlobalAdrBlueprint(root, 'bp-spa',  { slug: 'spa',  adrId: 'ADR-005-spa',  title: 'SPA',  decision: 'A.' });
  const rest = await writeGlobalAdrBlueprint(root, 'bp-rest', { slug: 'rest', adrId: 'ADR-003-rest', title: 'REST', decision: 'B.' });
  await runBin(root, ['blueprint', 'add', spa]);

  const ok = await runBin(root, [
    'blueprint', 'add', rest,
    '--resolve', 'auth=project:ADR-042',
    '--reason',  'Project auth ruling stands over both blueprint defaults.',
  ]);
  assert.equal(ok.code, 0, `stderr: ${ok.stderr}`);
  const manifest = JSON.parse(await _readFile(join(root, 'rcf', 'manifest.json'), 'utf8'));
  assert.equal(manifest.resolutions.length, 1);
  assert.equal(
    manifest.resolutions[0].reason,
    'Project auth ruling stands over both blueprint defaults.',
    'round-1 shipped --reason as dead code; this reason MUST persist end-to-end',
  );
});

test('rcf blueprint add --reason: whitespace-only reason is refused at the writer edge (rev-2 P1-2)', async () => {
  const root = await scaffold();
  const spa  = await writeGlobalAdrBlueprint(root, 'bp-spa',  { slug: 'spa',  adrId: 'ADR-005-spa',  title: 'SPA',  decision: 'A.' });
  const rest = await writeGlobalAdrBlueprint(root, 'bp-rest', { slug: 'rest', adrId: 'ADR-003-rest', title: 'REST', decision: 'B.' });
  await runBin(root, ['blueprint', 'add', spa]);

  const bad = await runBin(root, [
    'blueprint', 'add', rest,
    '--resolve', 'auth=project:ADR-042',
    '--reason',  '   ',
  ]);
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /--resolve reason for topic 'auth' must not be whitespace-only/);
});

test('rcf blueprint add --resolve: duplicate topic dedupes with a stderr warning; only one record persists (rev-2 P3-b)', async () => {
  const root = await scaffold();
  const spa  = await writeGlobalAdrBlueprint(root, 'bp-spa',  { slug: 'spa',  adrId: 'ADR-005-spa',  title: 'SPA',  decision: 'A.' });
  const rest = await writeGlobalAdrBlueprint(root, 'bp-rest', { slug: 'rest', adrId: 'ADR-003-rest', title: 'REST', decision: 'B.' });
  await runBin(root, ['blueprint', 'add', spa]);

  const dup = await runBin(root, [
    'blueprint', 'add', rest,
    '--resolve', 'auth=project:ADR-042',
    '--resolve', 'auth=project:ADR-999',
  ]);
  assert.equal(dup.code, 0, `stderr: ${dup.stderr}\nstdout: ${dup.stdout}`);
  assert.match(dup.stderr, /\[warn\] blueprint add: duplicate --resolve for topic 'auth'; keeping the first declaration only/);
  const manifest = JSON.parse(await _readFile(join(root, 'rcf', 'manifest.json'), 'utf8'));
  const authRes = manifest.resolutions.filter((r) => r.topic === 'auth');
  assert.equal(authRes.length, 1, `expected exactly one authtopic resolution record, got ${authRes.length}`);
  // First-wins: the ADR-042 declaration is the one that persists.
  assert.equal(authRes[0].resolvedByAdrId, 'ADR-042');
});

test('rcf blueprint add --resolve: validation error carries no doubled prefix (rev-2 P3-a)', async () => {
  const root = await scaffold();
  const rest = await writeGlobalAdrBlueprint(root, 'bp-rest', { slug: 'rest', adrId: 'ADR-003-rest', title: 'x', decision: 'y.' });
  const bad = await runBin(root, ['blueprint', 'add', rest, '--resolve', 'auth=project:notAnAdrId']);
  assert.equal(bad.code, 2);
  // The CLI prefixes '[error] blueprint add: '; the rcfError message
  // MUST NOT prepend its own 'blueprint add: '.
  assert.match(bad.stderr, /^\[error\] blueprint add: --resolve resolvedByAdrId 'notAnAdrId' is not a well-formed ADR id\./m);
  assert.doesNotMatch(bad.stderr, /blueprint add: blueprint add:/);
});

test('conflict enrichment is symmetric: incoming side carries title + decision read off the blueprint contribution file (rev-2 nit)', async () => {
  const root = await scaffold();
  const spa  = await writeGlobalAdrBlueprint(root, 'bp-spa',  { slug: 'spa',  adrId: 'ADR-005-spa',  title: 'SPA auth: cookies',      decision: 'Cookies for sessions.' });
  const rest = await writeGlobalAdrBlueprint(root, 'bp-rest', { slug: 'rest', adrId: 'ADR-003-rest', title: 'REST auth: bearer',      decision: 'JWT bearer for API.' });
  await runBin(root, ['blueprint', 'add', spa]);

  const conflict = await runBin(root, ['blueprint', 'add', rest]);
  assert.equal(conflict.code, 3);
  // Both sides carry `blueprint <slug>: <title> — <decision>` on the
  // header, not `<id> at <path>`.
  assert.match(conflict.stderr, /incoming\s+blueprint rest: REST auth: bearer — JWT bearer for API\./);
  assert.match(conflict.stderr, /existing\s+blueprint spa: SPA auth: cookies — Cookies for sessions\./);

  // --json shape also carries title + decision on both sides.
  const json = await runBin(root, ['blueprint', 'add', rest, '--json']);
  assert.equal(json.code, 3);
  const parsed = JSON.parse(json.stdout);
  const c = parsed.conflicts[0];
  assert.equal(c.incoming.title, 'REST auth: bearer');
  assert.equal(c.incoming.decision, 'JWT bearer for API.');
  assert.equal(c.existing.title, 'SPA auth: cookies');
  assert.equal(c.existing.decision, 'Cookies for sessions.');
});
