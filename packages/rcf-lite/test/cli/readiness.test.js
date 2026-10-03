// CLI tests for `rcf define readiness` (REQ-175; proposal §2.4,
// §6.2 v3).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, readFile as readFileAsync, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { Writable } from 'node:stream';

import { initProject } from '#core/store/init.js';

import { main } from '../../src/cli/readiness.js';

/** Buffered writable that exposes accumulated text. */
function makeSink() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, _enc, cb) { chunks.push(chunk); cb(); },
  });
  Object.defineProperty(stream, 'text', { get() { return Buffer.concat(chunks).toString('utf8'); } });
  return stream;
}

async function scratchProject(prefix = 'readiness-cli-') {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const result = await initProject({ projectRoot: root });
  assert.ok(result && Array.isArray(result.created), `initProject failed: ${JSON.stringify(result)}`);
  return root;
}

async function run(argv, cwd) {
  const stdout = makeSink();
  const stderr = makeSink();
  const code = await main(argv, { stdout, stderr, cwd });
  return { code, stdout: stdout.text, stderr: stderr.text };
}

test('readiness cli: --help prints the usage block (AC-17503-* help carries --level and --persona)', async () => {
  const cwd = await scratchProject();
  const r = await run(['--help'], cwd);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Usage: rcf define readiness/);
  assert.match(r.stdout, /--check <stage>/);
  assert.match(r.stdout, /--level <intent\|build>/);
  assert.match(r.stdout, /--persona <po\|engineer>/);
});

test('readiness cli: unknown --check name exits 2 with usage error', async () => {
  const cwd = await scratchProject();
  const r = await run(['--check', 'nonsense'], cwd);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /unknown --check/);
});

test('readiness cli: text output shape and --check exit codes', async () => {
  const cwd = await scratchProject();
  // On a freshly-initialised project the tree is minimal: the D1
  // brief check fails (no brief statements yet, no profile markers)
  // and D8 fails (no queue head). This is expected on a fresh init.
  const rDefault = await run([], cwd);
  assert.equal(rDefault.code, 0);
  assert.match(rDefault.stdout, /Unfrozen\./);
  // Verdict pair (spec section 2.3) prints at the top of every
  // readiness run.
  assert.match(rDefault.stdout, /^Intent-complete: /m);
  assert.match(rDefault.stdout, /^Ready-to-build: /m);
  // Per-persona next-action lines (spec section 4).
  assert.match(rDefault.stdout, /Next action \(product owner\):/);
  assert.match(rDefault.stdout, /Next action \(engineer\):/);
  assert.match(rDefault.stdout, /Chips: D1:/);
  assert.match(rDefault.stdout, /Freezeable: (yes|no)\./);

  // --check freeze -> blocking stage failing -> exit 4.
  const rFreeze = await run(['--check', 'freeze'], cwd);
  assert.equal(rFreeze.code, 4);
  assert.match(rFreeze.stdout, /D8 \(define.freeze\)/);

  // --check shapes on a fresh init: TAC-001 exists with no
  // interfaces, so D3 is failing without an acknowledgement. ADR-4131
  // (0.30.0 PR 5) makes D3 bite: an unacknowledged D3 failure exits 4
  // (previously 0 under 0.29.0 warn-with-ack).
  const rShapes = await run(['--check', 'shapes'], cwd);
  assert.equal(rShapes.code, 4);
  assert.match(rShapes.stdout, /D3 \(define.shapes\)/);
});

test('readiness cli: --json emits the full readiness object', async () => {
  const cwd = await scratchProject();
  const r = await run(['--json'], cwd);
  assert.equal(r.code, 0);
  const parsed = JSON.parse(r.stdout);
  assert.ok(parsed.tree);
  assert.ok(parsed.delta);
  assert.ok(Array.isArray(parsed.stages));
  assert.equal(parsed.stages.length, 8);
  assert.ok(parsed.coverage && parsed.coverage.tree);
  assert.equal(typeof parsed.freezeable, 'boolean');
  // _meta side-band is stable-by-convention.
  assert.ok(parsed._meta && typeof parsed._meta.wallMs === 'number');
});

test('readiness cli: no project root exits 2 with usage error', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'readiness-noroot-'));
  const r = await run([], cwd);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /no project root found/);
});

/**
 * Byte-level fingerprint of every file under `rcf/`.
 * Keys are repo-root-relative paths; values are a sha256 of the
 * file's bytes. Sorted iteration + JSON serialisation lets the test
 * assert equality with a single `assert.equal` on the whole map.
 */
function fingerprintRcfTree(projectRoot) {
  const root = join(projectRoot, 'rcf');
  /** @type {Map<string, string>} */
  const out = new Map();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const hash = createHash('sha256').update(readFileSync(full)).digest('hex');
        out.set(relative(projectRoot, full), hash);
      }
    }
  };
  walk(root);
  // Stable serialisation: a sorted array of [path, hash] tuples.
  const tuples = [...out.entries()].sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(tuples);
}

test('readiness cli: AC-17502-7 rcf/ tree is byte-stable across a readiness run (no mutation)', async () => {
  const cwd = await scratchProject('readiness-mutguard-');
  const before = fingerprintRcfTree(cwd);
  const r = await run(['--json'], cwd);
  assert.equal(r.code, 0);
  const after = fingerprintRcfTree(cwd);
  assert.equal(after, before, 'rcf/ tree changed under a readiness compute (AC-17502-7)');
});

// ---------------------------------------------------------------------------
// US-17503: --level and --persona flags, exit matrix, verdict wording.
// ---------------------------------------------------------------------------

test('readiness cli: AC-17503-1 default (no --check, no --level) exits 0 and prints both verdict lines', async () => {
  const cwd = await scratchProject();
  const r = await run([], cwd);
  assert.equal(r.code, 0);
  // Both verdict lines always print (spec section 2.3).
  assert.match(r.stdout, /^Intent-complete: no;/m);
  assert.match(r.stdout, /^Ready-to-build: no;/m);
});

test('readiness cli: AC-17503-2 --level intent exits 0 when PO is clean', async () => {
  const cwd = await scratchProject();
  // Seed a brief statement so brief:sinceFreeze and brief:kinds pass.
  await mkdir(join(cwd, 'rcf', 'define'), { recursive: true });
  const briefLedger = {
    statements: [
      {
        id: 1,
        kind: 'capability',
        text: 'The system lists items.',
        source: 'inline',
        addedAt: '2026-10-01T00:00:00Z',
        status: 'open',
        // skeleton:resolvedBy is PO: a resolving statement must point
        // at a REQ (or match a REQ title). REQ-001 below is edited to
        // carry the matching title so the statement resolves.
        resolvedBy: 'REQ-001',
      },
    ],
  };
  await writeFile(join(cwd, 'rcf', 'define', 'brief-ledger.json'), JSON.stringify(briefLedger, null, 2));
  // Write profile.md with surface + register markers (brief:profile).
  await mkdir(join(cwd, 'rcf', '.identity'), { recursive: true });
  await writeFile(
    join(cwd, 'rcf', '.identity', 'profile.md'),
    '# Profile\n\nSurface: viewer\nRegister: productOwner\n',
  );
  // Fix REQ-001 so skeleton:reqIntent (PO) passes. shapeClassification
  // is left absent on purpose: skeleton:reqShape is engineer and
  // --level intent must not care about it (AC-17503-2's precondition
  // is "only engineer checks fail").
  const reqPath = join(cwd, 'rcf', 'requirements', 'req-001.json');
  const req = JSON.parse(await readFileAsync(reqPath, 'utf8'));
  req.title = 'List items';
  req.description = 'The system lists items for the operator.';
  req.domain = 'defineDetection';
  await writeFile(reqPath, JSON.stringify(req, null, 2));
  // Act: --level intent on this PO-clean tree.
  const r = await run(['--level', 'intent'], cwd);
  assert.equal(r.code, 0, `expected exit 0, got ${r.code}; stderr: ${r.stderr}`);
  assert.match(r.stdout, /^Intent-complete: yes/m);
});

test('readiness cli: AC-17503-3 --level intent exits 4 when PO fails', async () => {
  const cwd = await scratchProject();
  const r = await run(['--level', 'intent'], cwd);
  assert.equal(r.code, 4);
  assert.match(r.stdout, /^Intent-complete: no;/m);
});

test('readiness cli: AC-17503-4 --level build exits 4 on a failing tree and prints warn lines for unacked warn-with-ack stages', async () => {
  const cwd = await scratchProject();
  const r = await run(['--level', 'build'], cwd);
  assert.equal(r.code, 4);
  assert.match(r.stdout, /^Ready-to-build: no;/m);
  // D3 is warn-with-ack and failing on a fresh init (TAC-001 has no
  // interfaces). --level build is stricter than --check all: it
  // exits 4 and prints the warn line.
  assert.match(r.stderr, /\[warn\] readiness: D3 \(define\.shapes\) is failing without an acknowledgement/);
});

test('readiness cli: AC-17503-5 --check all exits 4 on blocking failures (D3 bites in PR 5)', async () => {
  const cwd = await scratchProject();
  const r = await run(['--check', 'all'], cwd);
  // Fresh init has D1/D2/D4/D8 blocking failing, so --check all
  // exits 4. ADR-4131 (0.30.0 PR 5) also bites D3 under --check, so
  // D3 no longer emits a warn line in --check all; it drives exit 4
  // alongside the blocking stages. D5 and D6 still emit warns if they
  // happen to fail (warn-with-ack posture kept until PRs 6 and 7).
  assert.equal(r.code, 4);
});

test('readiness cli: AC-17503-6 --persona filters text and does not change exit', async () => {
  const cwd = await scratchProject();
  const rPlain = await run([], cwd);
  const rPo = await run(['--persona', 'productOwner'], cwd);
  const rEng = await run(['--persona', 'engineer'], cwd);
  assert.equal(rPo.code, rPlain.code);
  assert.equal(rEng.code, rPlain.code);
  // With --persona productOwner, the engineer block collapses.
  assert.match(rPo.stdout, /^Engineer: \d+ (check|checks) blocking \(hidden; run without --persona\)$/m);
  // The PO block prints its blockers in full.
  assert.match(rPo.stdout, /^Product owner: \d+ /m);
  // Mirror check for engineer.
  assert.match(rEng.stdout, /^Product owner: \d+ (question|questions) \(hidden; run without --persona\)$/m);
  assert.match(rEng.stdout, /^Engineer: \d+ /m);
});

test('readiness cli: AC-17503-7 unknown --level exits 2 with usage line', async () => {
  const cwd = await scratchProject();
  const r = await run(['--level', 'ship'], cwd);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /unknown --level ship \(expected intent \| build\)/);
});

test('readiness cli: AC-17503-7 unknown --persona exits 2 with usage line', async () => {
  const cwd = await scratchProject();
  const r = await run(['--persona', 'architect'], cwd);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /unknown --persona architect \(expected productOwner \| engineer\)/);
});

test('readiness cli: AC-17503-8 --json --level intent carries _meta.level and preserves levels + personas', async () => {
  const cwd = await scratchProject();
  const r = await run(['--json', '--level', 'intent'], cwd);
  // Exit 4 iff intentComplete is false; on a fresh init PO fails so
  // we expect 4.
  assert.equal(r.code, 4);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed._meta.level, 'intent');
  assert.ok(parsed.levels && parsed.levels.intentComplete);
  assert.ok(parsed.personas && parsed.personas.productOwner);
});

test('readiness cli: AC-17503-8 --json without --level emits _meta.level null', async () => {
  const cwd = await scratchProject();
  const r = await run(['--json'], cwd);
  assert.equal(r.code, 0);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed._meta.level, null);
});

test('readiness cli: AC-17503-9 text report groups PO before engineer with persona in detail lines', async () => {
  const cwd = await scratchProject();
  const r = await run([], cwd);
  const idxPo = r.stdout.indexOf('Product owner:');
  const idxEng = r.stdout.indexOf('Engineer:');
  assert.ok(idxPo >= 0, 'Product owner block present');
  assert.ok(idxEng > idxPo, 'Engineer block follows Product owner block');
  // Every per-stage detail check line carries persona inside the
  // parenthesis after `over` (spec section 4):
  //   [FAIL] brief:sinceFreeze (delta, productOwner): 0/1
  assert.match(r.stdout, /\[FAIL\] brief:sinceFreeze \(delta, productOwner\):/);
  assert.match(r.stdout, /\[FAIL\] skeleton:reqShape \(delta, engineer\):/);
});

// ---------------------------------------------------------------------------
// ADR-4131 (US-17404, AC-17404-5): rcf define readiness --check shapes
// exits 4 on an unacknowledged D3 failure and 0 when acked at the hash.
// ---------------------------------------------------------------------------

test('readiness cli: AC-17404-5 --check shapes exits 4 unacked and 0 acked at current hash', async () => {
  const cwd = await scratchProject();
  // Unacked: fresh init has D3 failing (TAC-001 has no interfaces).
  const rUnacked = await run(['--check', 'shapes'], cwd);
  assert.equal(rUnacked.code, 4, `stderr: ${rUnacked.stderr}`);
  assert.match(rUnacked.stdout, /D3 \(define\.shapes\)/);
  // The freeze record carries the acknowledgement at the current tree
  // hash so the --check shapes branch honours it. The record's own
  // `treeHash` and `docHashes` are deliberately a prior-state baseline
  // (empty `docHashes`, placeholder `treeHash`) so computeDelta sees
  // every document as changed, D3 is in scope with a real failing
  // check (tacHasInterface on TAC-001) rather than notApplicable, and
  // the exit-0 claim is attributable to the ack path alone, not to an
  // empty delta that would make D3 notApplicable and exit 0 for the
  // wrong reason (ADR-4131 masking fix landing with PR 5).
  const { walkTree } = await import('#core/store');
  const { computeDelta } = await import('../../src/query/delta.js');
  const { saveFreezeRecord } = await import('../../src/define/freeze-record.js');
  const { tree } = await walkTree({ projectRoot: cwd });
  const delta = computeDelta(tree, null, {});
  const currentHash = delta.currentTreeHash;
  const record = {
    frozenAt: '2026-10-03T10:50:00Z',
    treeHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    docHashes: {},
    briefStatements: 0,
    override: null,
    gates: {
      'define.shapes': {
        state: 'acknowledged',
        at: { hash: currentHash, reason: 'bite deferred for the test', by: 'test' },
      },
    },
  };
  await saveFreezeRecord({ projectRoot: cwd, record });
  // Re-walk and re-compute delta against the stored freeze so we can
  // assert the fixture now exercises the ack path: delta is non-empty,
  // D3 is failing (not notApplicable), and only the gate ack takes it
  // to exit 0.
  const { tree: tree2 } = await walkTree({ projectRoot: cwd });
  const delta2 = computeDelta(tree2, { treeHash: record.treeHash, docHashes: record.docHashes }, {});
  assert.ok(
    delta2.changed.length + delta2.added.length > 0,
    'fixture must produce a non-empty delta so D3 scope is non-empty and the ack path is really exercised',
  );
  const rAcked = await run(['--check', 'shapes'], cwd);
  assert.equal(rAcked.code, 0, `expected exit 0 after ack at hash, got ${rAcked.code}; stderr: ${rAcked.stderr}`);
  assert.match(rAcked.stdout, /D3 \(define\.shapes\): acknowledged/);
});

test('readiness cli: AC-17503-1 exit matrix (parameterised: --check + --level combinations; ADR-4131 D3 bite)', async () => {
  const cwd = await scratchProject();
  // Each row = { argv, expected exit }. The fresh-init tree has
  // blocking D1/D2/D4/D8 failing. ADR-4131 (0.30.0 PR 5) bites D3,
  // so --check shapes on an unacknowledged D3 failure now exits 4
  // (previously 0 under 0.29.0 warn-with-ack).
  const rows = [
    { argv: [], exit: 0 },
    { argv: ['--check', 'freeze'], exit: 4 },       // D8 blocking
    { argv: ['--check', 'shapes'], exit: 4 },       // D3 bites (ADR-4131)
    { argv: ['--check', 'all'], exit: 4 },          // blocking failures present
    { argv: ['--level', 'intent'], exit: 4 },       // PO fails
    { argv: ['--level', 'build'], exit: 4 },        // not freezeable
    { argv: ['--check', 'shapes', '--level', 'build'], exit: 4 },   // level says 4
    { argv: ['--check', 'freeze', '--level', 'intent'], exit: 4 },  // both say 4
  ];
  for (const row of rows) {
    const r = await run(row.argv, cwd);
    assert.equal(r.code, row.exit, `argv ${JSON.stringify(row.argv)} expected ${row.exit}, got ${r.code}`);
  }
});
