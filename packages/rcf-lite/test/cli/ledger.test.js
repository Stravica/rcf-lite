// CLI tests for `rcf define ledger` (REQ-173; proposal §8.2 v3).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { main } from '../../src/cli/ledger.js';
import { loadLedger, ledgerRelPath } from '../../src/define/ledgers.js';

function makeSink() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, _enc, cb) { chunks.push(chunk); cb(); },
  });
  Object.defineProperty(stream, 'text', { get() { return Buffer.concat(chunks).toString('utf8'); } });
  return stream;
}

async function scratchProject(prefix = 'ledger-cli-') {
  const cwd = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(cwd, 'rcf'), { recursive: true });
  // Minimal manifest so findProjectRoot succeeds; the walker is never
  // called by the ledger CLI so the manifest need not be schema-valid.
  await writeFile(join(cwd, 'rcf', 'manifest.json'), JSON.stringify({ prdId: 'PRD-001' }), 'utf8');
  return cwd;
}

async function run(argv, cwd) {
  const stdout = makeSink();
  const stderr = makeSink();
  const code = await main(argv, { stdout, stderr, cwd });
  return { code, stdout: stdout.text, stderr: stderr.text };
}

test('ledger CLI: brief add --text appends a numbered statement', async () => {
  const cwd = await scratchProject();
  const r1 = await run([
    'brief', 'add', '--kind', 'capability', '--text', 'ship freeze detection',
  ], cwd);
  assert.equal(r1.code, 0, r1.stderr);
  assert.match(r1.stdout, /ids 1/);
  const body = await loadLedger({ projectRoot: cwd, name: 'brief' });
  assert.equal(body.statements.length, 1);
  assert.equal(body.statements[0].kind, 'capability');
  assert.equal(body.statements[0].id, 1);
});

test('ledger CLI: brief add --from <file> splits by non-empty line', async () => {
  const cwd = await scratchProject();
  const brief = join(cwd, 'briefs.md');
  await writeFile(brief, '- Statement one\n- Statement two\n\n- Statement three\n', 'utf8');
  const r = await run(['brief', 'add', '--from', brief, '--kind', 'capability'], cwd);
  assert.equal(r.code, 0, r.stderr);
  const body = await loadLedger({ projectRoot: cwd, name: 'brief' });
  assert.equal(body.statements.length, 3);
  assert.deepEqual(body.statements.map((s) => s.text), [
    'Statement one', 'Statement two', 'Statement three',
  ]);
  assert.deepEqual(body.statements.map((s) => s.id), [1, 2, 3]);
});

test('ledger CLI: decisions list prints the numbered #241 format', async () => {
  const cwd = await scratchProject();
  await run([
    'decisions', 'add',
    '--question', 'What is the AC class marker?',
    '--option', 'a:bracketed prefix on description',
    '--option', 'b:schema field',
    '--default', 'a',
    '--blocks', 'D4',
  ], cwd);
  const list = await run(['decisions', 'list'], cwd);
  assert.equal(list.code, 0, list.stderr);
  assert.match(list.stdout, /^1\. What is the AC class marker\?/m);
  assert.match(list.stdout, /^\s*a\) bracketed prefix on description$/m);
  assert.match(list.stdout, /^\s*b\) schema field$/m);
  assert.match(list.stdout, /default: a/);
  assert.match(list.stdout, /blocks: D4/);
});

test('ledger CLI: unknown ledger name exits 2 with a usage error', async () => {
  const cwd = await scratchProject();
  const r = await run(['not-a-ledger', 'list'], cwd);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /unknown name 'not-a-ledger'/);
});

test('ledger CLI: brief add refuses conflicting --text and --from with a usage error', async () => {
  const cwd = await scratchProject();
  const briefFile = join(cwd, 'x.md');
  await writeFile(briefFile, 'line', 'utf8');
  const r = await run(['brief', 'add', '--text', 't', '--from', briefFile], cwd);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--text OR --from/);
});

test('ledger CLI: resolve <id> flips status to resolved and stamps resolvedAt', async () => {
  const cwd = await scratchProject();
  await run(['probes', 'add', '--req', 'REQ-172', '--finding', 'x', '--severity', 'low'], cwd);
  const r = await run(['probes', 'resolve', '1', '--reason', 'fixed'], cwd);
  assert.equal(r.code, 0, r.stderr);
  const body = await loadLedger({ projectRoot: cwd, name: 'probes' });
  assert.equal(body.probes[0].status, 'resolved');
  assert.ok(body.probes[0].resolvedAt);
  assert.equal(body.probes[0].reason, 'fixed');
});

test('ledger CLI: list --json emits the machine-readable envelope', async () => {
  const cwd = await scratchProject();
  await run(['brief', 'add', '--text', 'x', '--kind', 'capability'], cwd);
  const r = await run(['brief', 'list', '--json'], cwd);
  assert.equal(r.code, 0, r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.ledger, 'brief');
  assert.equal(parsed.statements.length, 1);
});

test('ledger CLI: writes land at the proposal-mandated relative path', async () => {
  const cwd = await scratchProject();
  await run(['brief', 'add', '--text', 'x'], cwd);
  const raw = await readFile(join(cwd, ledgerRelPath('brief')), 'utf8');
  const parsed = JSON.parse(raw);
  assert.equal(parsed.statements[0].text, 'x');
});

// ---------------------------------------------------------------------------
// REQ-187 (US-18701, US-18702): markers, scan wiring, --findings, --dry-run.
// ---------------------------------------------------------------------------

test('ledger CLI (AC-18701-1): brief add --from parses [kind] and (source: ...) markers', async () => {
  const cwd = await scratchProject();
  const briefFile = join(cwd, 'brief.md');
  await writeFile(
    briefFile,
    '- [constraint] A loan on hold must not accrue late fees. (source: briefs/x.md:15)\n',
    'utf8',
  );
  const r = await run(['brief', 'add', '--from', briefFile, '--no-scan'], cwd);
  assert.equal(r.code, 0, r.stderr);
  const body = await loadLedger({ projectRoot: cwd, name: 'brief' });
  assert.equal(body.statements.length, 1);
  assert.equal(body.statements[0].kind, 'constraint');
  assert.equal(body.statements[0].text, 'A loan on hold must not accrue late fees.');
  assert.equal(body.statements[0].source, 'briefs/x.md:15');
});

test('ledger CLI (AC-18701-5): brief add --from with an unknown [kind] exits 2 before writing', async () => {
  const cwd = await scratchProject();
  const briefFile = join(cwd, 'brief.md');
  await writeFile(briefFile, '[gadget] text\n', 'utf8');
  const r = await run(['brief', 'add', '--from', briefFile], cwd);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /unknown kind 'gadget'/);
  // no ledger file created
  await assert.rejects(() => readFile(join(cwd, ledgerRelPath('brief')), 'utf8'));
});

test('ledger CLI (AC-18701-6, --dry-run): writes nothing', async () => {
  const cwd = await scratchProject();
  const briefFile = join(cwd, 'brief.md');
  await writeFile(briefFile, '- Statement one\n- Statement two\n', 'utf8');
  const r = await run(['brief', 'add', '--from', briefFile, '--no-scan', '--dry-run'], cwd);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /\[dry-run\]/);
  await assert.rejects(() => readFile(join(cwd, ledgerRelPath('brief')), 'utf8'));
});

test('ledger CLI (AC-18702-2): --findings file mints one openQuestion per finding with scan: source', async () => {
  const cwd = await scratchProject();
  const briefFile = join(cwd, 'brief.md');
  // A plain capability sentence that trips none of the mechanical scans.
  await writeFile(briefFile, '- The system records counts.\n', 'utf8');
  const findings = join(cwd, 'findings.json');
  await writeFile(findings, JSON.stringify({
    validationFindings: [
      { kind: 'impliedButNotStated', detail: 'q1' },
      { kind: 'contradiction', detail: 'q2' },
    ],
  }), 'utf8');
  const r = await run(
    ['brief', 'add', '--from', briefFile, '--findings', findings],
    cwd,
  );
  assert.equal(r.code, 0, r.stderr);
  const body = await loadLedger({ projectRoot: cwd, name: 'brief' });
  const openQuestions = body.statements.filter((s) => s.kind === 'openQuestion');
  // At least the two from --findings land; mechanical scans find nothing on this input.
  assert.ok(openQuestions.length >= 2);
  const findingByText = Object.fromEntries(openQuestions.map((s) => [s.text, s]));
  assert.ok(findingByText.q1?.source?.startsWith('scan:'));
  assert.ok(findingByText.q2?.source?.startsWith('scan:'));
});

test('ledger CLI (AC-18702-4, --json): emits { added, findings }', async () => {
  const cwd = await scratchProject();
  const briefFile = join(cwd, 'brief.md');
  await writeFile(briefFile, '- The system records counts.\n', 'utf8');
  const findings = join(cwd, 'findings.json');
  await writeFile(findings, JSON.stringify({
    validationFindings: [{ kind: 'impliedButNotStated', detail: 'q1' }],
  }), 'utf8');
  const r = await run(
    ['brief', 'add', '--from', briefFile, '--findings', findings, '--json'],
    cwd,
  );
  assert.equal(r.code, 0, r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.ok(Array.isArray(parsed.added));
  assert.ok(Array.isArray(parsed.findings));
  assert.equal(parsed.added.length, 1);
  assert.ok(parsed.findings.length >= 1);
});

test('ledger CLI (AC-18702-5): --no-scan with --findings exits 2', async () => {
  const cwd = await scratchProject();
  const briefFile = join(cwd, 'brief.md');
  await writeFile(briefFile, '- s\n', 'utf8');
  const findings = join(cwd, 'findings.json');
  await writeFile(findings, '{"validationFindings":[]}', 'utf8');
  // --no-scan + --findings fails.
  const r = await run(
    ['brief', 'add', '--from', briefFile, '--no-scan', '--findings', findings],
    cwd,
  );
  // Spec section 2.2 and AC-18702-5: --no-scan combined with --findings
  // exits 2.
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--no-scan and --findings cannot be combined/);
});

test('ledger CLI (AC-18702-6): --text runs no scan and appends no openQuestion', async () => {
  const cwd = await scratchProject();
  const r = await run(['brief', 'add', '--text', 'A new capability.'], cwd);
  assert.equal(r.code, 0, r.stderr);
  const body = await loadLedger({ projectRoot: cwd, name: 'brief' });
  assert.equal(body.statements.length, 1);
  assert.equal(body.statements[0].kind, 'capability');
});

test('ledger CLI (AC-18702-1): mechanical scan on brief add mints an openQuestion with scan: source', async () => {
  const cwd = await scratchProject();
  const briefFile = join(cwd, 'brief.md');
  // Trigger the "no login + admin UI" contradiction scan.
  await writeFile(
    briefFile,
    '- No login is required.\n- The admin dashboard lists all tenants.\n',
    'utf8',
  );
  const r = await run(['brief', 'add', '--from', briefFile], cwd);
  assert.equal(r.code, 0, r.stderr);
  const body = await loadLedger({ projectRoot: cwd, name: 'brief' });
  const openQ = body.statements.filter((s) => s.kind === 'openQuestion');
  assert.ok(openQ.length >= 1, `expected an openQuestion from scan, got ${JSON.stringify(body.statements, null, 2)}`);
  const contradiction = openQ.find((s) => s.source?.startsWith('scan:contradiction'));
  assert.ok(contradiction, `expected a scan:contradiction openQuestion, got ${JSON.stringify(openQ, null, 2)}`);
  // The source names ids from both statements.
  assert.match(contradiction.source, /scan:contradiction:\d+,\d+/);
});

// ---------------------------------------------------------------------------
// REQ-173 amendment (US-17302): ledger <name> update <id>.
// ---------------------------------------------------------------------------

test('ledger CLI (AC-17302-1): brief update patches kind and resolvedBy and keeps id and addedAt', async () => {
  const cwd = await scratchProject();
  for (let i = 0; i < 7; i += 1) {
    await run(['brief', 'add', '--text', `s${i}`, '--kind', 'capability'], cwd);
  }
  const before = await loadLedger({ projectRoot: cwd, name: 'brief' });
  const beforeAddedAt = before.statements[6].addedAt;
  const r = await run(
    ['brief', 'update', '7', '--kind', 'constraint', '--resolved-by', 'REQ-003'],
    cwd,
  );
  assert.equal(r.code, 0, r.stderr);
  const body = await loadLedger({ projectRoot: cwd, name: 'brief' });
  const seven = body.statements[6];
  assert.equal(seven.id, 7);
  assert.equal(seven.addedAt, beforeAddedAt);
  assert.equal(seven.kind, 'constraint');
  assert.equal(seven.resolvedBy, 'REQ-003');
});

test('ledger CLI (AC-17302-4): brief update --resolved-by outside the grammar exits 2 and writes nothing', async () => {
  const cwd = await scratchProject();
  await run(['brief', 'add', '--text', 's', '--kind', 'capability'], cwd);
  const before = await loadLedger({ projectRoot: cwd, name: 'brief' });
  const r = await run(
    ['brief', 'update', '1', '--resolved-by', 'loan thing'],
    cwd,
  );
  assert.equal(r.code, 2);
  assert.match(r.stderr, /outside grammar/);
  const after = await loadLedger({ projectRoot: cwd, name: 'brief' });
  assert.deepEqual(after, before);
});

test('ledger CLI (AC-17302-2): decisions update patches options and default', async () => {
  const cwd = await scratchProject();
  await run([
    'decisions', 'add',
    '--question', 'Pick a store?',
    '--option', 'a:postgres',
    '--default', 'a',
  ], cwd);
  const r = await run([
    'decisions', 'update', '1',
    '--option', 'a:postgres',
    '--option', 'b:sqlite',
    '--default', 'a',
  ], cwd);
  assert.equal(r.code, 0, r.stderr);
  const body = await loadLedger({ projectRoot: cwd, name: 'decisions' });
  assert.equal(body.decisions[0].options.length, 2);
  assert.equal(body.decisions[0].default, 'a');
});

// =============================================================================
// DEFINE step 3 ruling R1 (w-2026-10-05-dave-001). Test skeletons at
// chain-commit time; the implementation commit replaces the bodies with
// substantive assertions. Each test's name matches the testPointer in the
// chain so `audit coverage` resolves them.

test('ledger CLI (R1, AC-17302-7): add --id on same-content is unchanged exit 0', async () => {
  const cwd = await scratchProject();
  const first = await run(['brief', 'add', '--id', '1', '--kind', 'capability', '--text', 'ship it'], cwd);
  assert.equal(first.code, 0, first.stderr);
  const bodyAfterFirst = await loadLedger({ projectRoot: cwd, name: 'brief' });
  assert.equal(bodyAfterFirst.statements.length, 1);
  assert.equal(bodyAfterFirst.statements[0].id, 1);
  const addedAt = bodyAfterFirst.statements[0].addedAt;
  // Replay with the SAME content: unchanged, exit 0, file not rewritten.
  const replay = await run(['brief', 'add', '--id', '1', '--kind', 'capability', '--text', 'ship it'], cwd);
  assert.equal(replay.code, 0, replay.stderr);
  assert.match(replay.stdout, /brief-ledger: unchanged 1/);
  const bodyAfterReplay = await loadLedger({ projectRoot: cwd, name: 'brief' });
  assert.equal(bodyAfterReplay.statements.length, 1, 'no duplicate');
  assert.equal(bodyAfterReplay.statements[0].addedAt, addedAt, 'addedAt preserved');
  // --json emits status unchanged.
  const replayJson = await run(['brief', 'add', '--id', '1', '--kind', 'capability', '--text', 'ship it', '--json'], cwd);
  assert.equal(replayJson.code, 0);
  const payload = JSON.parse(replayJson.stdout);
  assert.equal(payload.status, 'unchanged');
  assert.equal(payload.id, 1);
});

test('ledger CLI (R1, AC-17302-8): add --id on different-content exits 3 naming fields', async () => {
  const cwd = await scratchProject();
  const first = await run(['brief', 'add', '--id', '1', '--kind', 'capability', '--text', 'ship it'], cwd);
  assert.equal(first.code, 0, first.stderr);
  const bodyAfterFirst = await loadLedger({ projectRoot: cwd, name: 'brief' });
  const original = bodyAfterFirst.statements[0];
  // Same id, DIFFERENT text and kind: refuse with exit 3 naming the fields.
  const conflict = await run(['brief', 'add', '--id', '1', '--kind', 'constraint', '--text', 'different sentence'], cwd);
  assert.equal(conflict.code, 3, `expected exit 3; got ${conflict.code}; stderr=${conflict.stderr}`);
  assert.match(conflict.stderr, /entry 1 already exists with different content/);
  assert.match(conflict.stderr, /kind/);
  assert.match(conflict.stderr, /text/);
  const bodyAfterRefuse = await loadLedger({ projectRoot: cwd, name: 'brief' });
  assert.deepEqual(bodyAfterRefuse.statements[0], original, 'file unchanged on conflict');
});

test('ledger CLI (R1, AC-17302-9): add without --id mints next id', async () => {
  const cwd = await scratchProject();
  const r = await run(['brief', 'add', '--kind', 'capability', '--text', 'ship it'], cwd);
  assert.equal(r.code, 0, r.stderr);
  const body = await loadLedger({ projectRoot: cwd, name: 'brief' });
  assert.equal(body.statements.length, 1);
  assert.equal(body.statements[0].id, 1);
});

// -- Issue 310 regression -------------------------------------------------
//
// `--dry-run` on `rcf define ledger concerns add` must leave the tree
// untouched: on 0.31.0 the flag was accepted but the ledger file was
// created and the entry appended. The byte-equal assertion covers
// both the "file does not exist beforehand" case (create skipped) and
// the "file exists and is already populated" case (contents
// preserved).
import { stat } from 'node:fs/promises';

async function treeBytes(cwd) {
  const relPaths = [
    'rcf/manifest.json',
    'rcf/define/brief-ledger.json',
    'rcf/define/decisions-ledger.json',
    'rcf/define/concern-ledger.json',
    'rcf/define/probes-ledger.json',
  ];
  const parts = [];
  for (const rel of relPaths) {
    const abs = join(cwd, rel);
    let exists = true;
    try { await stat(abs); } catch { exists = false; }
    if (!exists) { parts.push(`${rel}:ABSENT`); continue; }
    const bytes = await readFile(abs);
    parts.push(`${rel}:${bytes.length}:${bytes.toString('hex')}`);
  }
  return parts.join('\n');
}

test('ledger CLI (issue 310): concerns add --dry-run writes nothing when the ledger does not yet exist', async () => {
  const cwd = await scratchProject('ledger-dry-run-concerns-fresh-');
  const before = await treeBytes(cwd);
  const r = await run([
    'concerns', 'add',
    '--req', 'REQ-001',
    '--concern', 'auth',
    '--disposition', 'applied',
    '--reason', 'test rehearsal only',
    '--dry-run',
  ], cwd);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /\[dry-run\] concern-ledger: would add concern/);
  const after = await treeBytes(cwd);
  assert.equal(after, before, 'tree bytes unchanged after dry-run');
  // Also assert the concern-ledger file was NOT created at all.
  let created = false;
  try { await stat(join(cwd, 'rcf', 'define', 'concern-ledger.json')); created = true; } catch { created = false; }
  assert.equal(created, false, 'concern-ledger.json must not be created on --dry-run');
});

test('ledger CLI (issue 310): concerns add --dry-run writes nothing when the ledger is already populated', async () => {
  const cwd = await scratchProject('ledger-dry-run-concerns-pop-');
  // Prime the ledger with a real entry so a dry-run has existing content to not touch.
  const prime = await run([
    'concerns', 'add',
    '--req', 'REQ-999',
    '--concern', 'retention',
    '--disposition', 'waived',
    '--reason', 'historical lane, kept for audit',
  ], cwd);
  assert.equal(prime.code, 0, prime.stderr);
  const before = await treeBytes(cwd);
  const r = await run([
    'concerns', 'add',
    '--req', 'REQ-001',
    '--concern', 'auth',
    '--disposition', 'applied',
    '--reason', 'rehearsal only, do not persist',
    '--dry-run',
  ], cwd);
  assert.equal(r.code, 0, r.stderr);
  const after = await treeBytes(cwd);
  assert.equal(after, before, 'tree bytes unchanged after dry-run');
});

test('ledger CLI (issue 310): concerns add --dry-run --json emits dryRun:true and writes nothing', async () => {
  const cwd = await scratchProject('ledger-dry-run-concerns-json-');
  const before = await treeBytes(cwd);
  const r = await run([
    'concerns', 'add',
    '--req', 'REQ-001',
    '--concern', 'auth',
    '--disposition', 'applied',
    '--reason', 'rehearsal only, do not persist',
    '--dry-run',
    '--json',
  ], cwd);
  assert.equal(r.code, 0, r.stderr);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.dryRun, true);
  assert.equal(payload.entry.concern, 'auth');
  const after = await treeBytes(cwd);
  assert.equal(after, before, 'tree bytes unchanged after dry-run');
});
