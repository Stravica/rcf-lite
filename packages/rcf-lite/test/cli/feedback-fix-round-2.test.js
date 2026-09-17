// Fix round 2 probes for PR #221 (feat/feedback-submission-chain).
// Every test here binds one item from the reviewer's re-review, using
// the reviewer's runtime probe as the test.
//
// Layout: unit-shaped tests import from ../../src/... directly;
// integration-shaped tests drive bin/rcf.js the same way the other
// cli/feedback-*.test.js files do.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { initProject } from '#core/store/init.js';
import { BODY_CAP_BYTES, findResidualSecrets } from '../../src/feedback/redact.js';
import { capRenderedBody } from '../../src/feedback/render.js';
import { mintUniqueEntryId, appendEntry } from '../../src/feedback/store.js';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, '..', '..', 'bin', 'rcf.js');

async function runBin(cwd, args = [], extraEnv = {}) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [bin, ...args], {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        CI: '1',
        RCF_FEEDBACK_SESSION_ID: 'test-session',
        ...extraEnv,
      },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

async function scaffold(name = 'FixRound2Project') {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-feedback-fixround2-'));
  await initProject({ projectRoot: tmp, projectName: name });
  await writeFile(join(tmp, '.gitignore'), '.rcf/feedback/\n', 'utf8');
  return tmp;
}

async function addCore(cwd, title, body = 'body-content', extra = []) {
  const res = await runBin(cwd, [
    'feedback', 'add',
    '--kind', 'core',
    '--target', 'define validate',
    '--anchor', 'REQ-155',
    '--class', 'docs-mismatch',
    '--severity', 'minor',
    '--title', title,
    '--body', body,
    '--evidence', 'rcf define validate',
    ...extra,
  ]);
  assert.equal(res.code, 0, `add failed: ${res.stderr}`);
  const m = res.stdout.match(/recorded (fb-\d{8}-[0-9a-f]{12})/);
  return m[1];
}

// -- F-slice-2-09 (mergeLedger fold-by-(rule,before)) --------------------

test('F-slice-2-09 (fix round 2): preview ledger keeps distinct secret samples through mergeLedger', async () => {
  // Reviewer complaint: the redactor kept one row per distinct
  // before-sample (fixed earlier) but the cli-side mergeLedger then
  // folded all secret-token rows into one before reaching the
  // operator. Two distinct tokens must survive the merge as two rows.
  const tmp = await scaffold();
  const filler = 'abcdefghijklmnopqrstuvwxyz1234567890';
  const t1 = ['ghp_', filler].join('');
  const t2 = ['sk_', 'live_', filler.slice(0, 20)].join('');
  await addCore(tmp, 'two-secrets', `${t1} and ${t2}`);
  const res = await runBin(tmp, ['feedback', 'preview', '--json']);
  assert.equal(res.code, 0, res.stderr);
  const arr = JSON.parse(res.stdout);
  const secretRows = arr[0].ledger.filter((r) => r.rule === 'secret-token');
  assert.ok(secretRows.length >= 2, `expected at least 2 secret-token rows in preview ledger, got ${secretRows.length}`);
});

// -- F-slice-1-03 (fail-closed on id-exhaustion) -------------------------

test('F-slice-1-03 (fix round 2): mintUniqueEntryId throws when every retry collides (fail closed)', async () => {
  const tmp = await scaffold();
  // Seed an entry whose id every rng draw would collide with; the
  // constant rng makes every mint attempt regenerate the same id.
  const clock = new Date(Date.UTC(2026, 8, 16, 10, 0, 0));
  const rng = () => 0.5; // deterministic - always the same id
  const collide = 'fb-20260916-800080008000';
  await appendEntry(tmp, {
    id: collide, recordedAt: '2026-09-16T10:00:00Z', kind: 'core', status: 'pending',
    target: { ref: 'x' }, symptomClass: 'other', severity: 'minor', title: 't', body: 'b',
    evidence: [], environment: {}, askNow: false,
  });
  let threw = null;
  try { await mintUniqueEntryId(tmp, clock, rng); } catch (err) { threw = err; }
  assert.ok(threw, 'exhausted retries must throw');
  assert.equal(threw.code, 'FEEDBACK_ID_EXHAUSTED', 'error carries a stable code the caller keys off');
});

// -- F-slice-2-10 (cap the assembled body after evidence) ----------------

test('F-slice-2-10 (fix round 2): oversized evidence never pushes the rendered body past the cap', async () => {
  // Reviewer runtime probe: 8192-byte evidence rendered 8639 bytes.
  // capRenderedBody now guarantees the return is within the cap
  // whatever the tail size, so the safety net trips on this case.
  const stuffed = 'x'.repeat(BODY_CAP_BYTES + 2048);
  // Assemble a body shape that mirrors renderBody: free-form head +
  // the fence + a large evidence-like tail.
  const body = ['head-of-body', '', '---', '**Evidence**', `- \`${stuffed}\` (command)`, '', 'tail-consent'].join('\n');
  const capped = capRenderedBody(body);
  assert.ok(
    Buffer.byteLength(capped, 'utf8') <= BODY_CAP_BYTES,
    `capped body ${Buffer.byteLength(capped, 'utf8')} bytes must not exceed BODY_CAP_BYTES ${BODY_CAP_BYTES}`,
  );
  assert.match(capped, /\[truncated by rcf feedback\]/);
});

// -- F-slice-1-04 (CLI help wording matches R1) --------------------------

test('F-slice-1-04 (fix round 2): feedback --help exit-code block matches ruling R1', async () => {
  // R1: exit 3 ONLY when `--kind blueprint` AND the target is absent
  // from `rcf/manifest.json:blueprints[]` (unknown target). The old
  // CLI help block still carried the pre-R1 "destination cannot be
  // resolved" language; the reviewer flagged it as a doc-vs-code drift.
  const tmp = await scaffold();
  const res = await runBin(tmp, ['feedback', 'add', '--help']);
  assert.equal(res.code, 0);
  assert.match(res.stdout, /--kind blueprint AND the target is absent/, 'help text names the R1 unknown-target rule');
  assert.match(res.stdout, /destination:unresolved/i, 'help text names the exit-0 unresolved-destination branch');
  assert.match(res.stdout, /submit\s+\/\s+preview:\s+at least one entry stayed pending/, 'help text names the submit-side exit-3 branch');
});

// -- F-slice-1-10 (--json status carries destinations.table) -------------

test('F-slice-1-10 (fix round 2): rcf feedback status --json carries destinations.table', async () => {
  const tmp = await scaffold();
  // No applied blueprints on the seeded manifest, so the table is
  // empty; the key must still be present.
  const res = await runBin(tmp, ['feedback', 'status', '--json']);
  assert.equal(res.code, 0);
  const obj = JSON.parse(res.stdout);
  assert.ok(Object.prototype.hasOwnProperty.call(obj.destinations, 'table'), 'destinations.table key must be present in --json');
  assert.ok(Array.isArray(obj.destinations.table), 'destinations.table must be an array');
});

// -- F-slice-1-09 (retention clock from discard transition) --------------

test('F-slice-1-09 (fix round 2): a stale recordedAt with a fresh discard does NOT prune', async () => {
  // Reviewer complaint: the 30-day clock ran from recordedAt so a
  // 60-day-old finding discarded TODAY was pruned on the next add.
  // The clock now runs from the discard transition timestamp.
  const tmp = await scaffold();
  // Seed a pending entry recorded 60 days ago.
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  await appendEntry(tmp, {
    id: 'fb-19700101-aaaabbbbcccc',
    recordedAt: sixtyDaysAgo,
    kind: 'core', target: { ref: 'define validate' },
    anchor: null, symptomClass: 'other', severity: 'minor',
    title: 'stale', body: 'stale', evidence: [], environment: {},
    askNow: false, status: 'pending',
  });
  // Discard it today (via the CLI so a real state transition is stamped).
  const disc = await runBin(tmp, ['feedback', 'discard', 'fb-19700101-aaaabbbbcccc']);
  assert.equal(disc.code, 0, disc.stderr);
  // Kick the prune sweep.
  await addCore(tmp, 'kicks-the-prune');
  const list = JSON.parse((await runBin(tmp, ['feedback', 'list', '--all', '--json'])).stdout);
  const row = list.find((e) => e.id === 'fb-19700101-aaaabbbbcccc');
  assert.equal(row.status, 'discarded', 'freshly-discarded stale-recordedAt entry must stay discarded');
});

test('F-slice-1-09 (fix round 2): pruned count is visible in status counts', async () => {
  const tmp = await scaffold();
  // Seed an ancient discarded entry (recordedAt used as discard ts).
  await appendEntry(tmp, {
    id: 'fb-19700101-ccccddddeeee',
    recordedAt: '1970-01-01T00:00:00Z',
    kind: 'core', target: { ref: 'define validate' },
    anchor: null, symptomClass: 'other', severity: 'minor',
    title: 'ancient', body: 'ancient', evidence: [], environment: {},
    askNow: false, status: 'discarded',
  });
  await addCore(tmp, 'kicks-the-prune');
  const status = JSON.parse((await runBin(tmp, ['feedback', 'status', '--json'])).stdout);
  assert.ok(Object.prototype.hasOwnProperty.call(status.counts, 'pruned'), 'status.counts.pruned key present');
  assert.equal(status.counts.pruned, 1, 'ancient entry pruned by the sweep');
});

// -- Design safeguard (AC-15601-4) ---------------------------------------

test('AC-15601-4 safeguard: whole-text residual scan detects a multiline PEM in the rendered surface', async () => {
  // The per-entry safeguard runs findResidualSecrets on the fully
  // rendered and normalised issue body. This test asserts the scan
  // catches a multiline shape (PEM) end-to-end - the per-line scan
  // that shipped with slice 2 could not.
  const rendered = [
    'This is a rendered body',
    '',
    '-----BEGIN RSA PRIVATE KEY-----',
    'MIIEowIBAAKCAQEAwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww',
    '-----END RSA PRIVATE KEY-----',
    '',
    'consent tail',
  ].join('\n');
  const hits = findResidualSecrets(rendered);
  assert.ok(hits.some((h) => h.pattern === 'pem'), 'safeguard must detect multiline PEM in the rendered surface');
});

test('AC-15601-4 safeguard: submit refuses (exit 3) when a title-embedded token survives to the rendered body', async () => {
  // Construct an entry whose body would normalise to a shape the
  // first pass wrote but the residual scan then catches - the
  // obfuscated token has enough entropy characters after
  // normalisation that the loose token regex bites. This is the
  // reviewer's canonical AC-15601-2 setup rewritten to prove the
  // whole-text scan is on the rendered body.
  const tmp = await scaffold();
  const filler = 'abcdefghijklmnopqrstuvwxyz1234567890';
  // The primary secret pattern needs `\b` boundaries around the
  // token; a token buried inside a longer word-char identifier
  // (xxx-prefix, yyy-suffix - both word chars) trips no `\b`, so
  // the first pass skips it. The residual (loose) pattern set drops
  // the boundaries, so the whole-text scan catches it. This is the
  // canonical AC-15601-2 shape rewritten to prove the whole-text
  // residual scan runs on the rendered body.
  const stealthToken = 'xxx' + ['ghp', '_', filler].join('') + 'yyy';
  // Round 5 note: the body prose deliberately avoids a vocabulary
  // keyword (token / password / secret / ...) followed by a prose
  // bridge, so the R4 (round-5) pass does not fold the stealth token
  // during the primary redaction; the assertion is that the residual
  // scan is what catches this shape and refuses submit.
  await addCore(tmp, 'stealthy-secret', `an arbitrary identifier ${stealthToken} appears in the trace`);
  const previewRes = await runBin(tmp, ['feedback', 'preview', '--json']);
  assert.equal(previewRes.code, 0, previewRes.stderr);
  const preview = JSON.parse(previewRes.stdout)[0];
  assert.ok(preview.residual.length > 0, 'preview must surface a residual for a stealth token');
  const submitRes = await runBin(tmp, ['feedback', 'submit', '--yes', '--dry-run']);
  // The residual entry stays pending; submit's exit code is 3 as
  // long as at least one entry did not leave.
  assert.equal(submitRes.code, 3, `submit must return exit 3 when a residual keeps an entry pending; stderr=${submitRes.stderr}, stdout=${submitRes.stdout}`);
});

// -- library refresh --dry-run -------------------------------------------

// The refresh test needs a shipped local blueprint library; the
// packaged shelf under packages/rcf-lite/blueprints/ is not part of a
// fresh-checkout test tmp dir. Rather than build a library from
// scratch (heavy), assert the dry-run flag is threaded into every
// writeLibraryRegistry site by grepping the source - this is the
// minimal cheap probe that catches the exact regression the reviewer
// found (three writes ignoring the flag) without spinning a real
// library up.
test('library refresh --dry-run: every writeLibraryRegistry site in handleRefresh sits behind !dryRun', async () => {
  const src = await readFile(
    resolve(here, '..', '..', 'src', 'cli', 'blueprint-library.js'),
    'utf8',
  );
  // Locate the handleRefresh function block and lift its body.
  const start = src.indexOf('async function handleRefresh');
  assert.ok(start > 0, 'handleRefresh must exist in blueprint-library.js');
  // The function extends to end-of-file for our search purposes;
  // downstream helpers do not call writeLibraryRegistry.
  const body = src.slice(start);
  // Two shapes are acceptable per site: `!dryRun` in the guard, or a
  // dryRun-aware writer call. Count the write calls first, then the
  // guards, and assert they line up.
  const writeSites = [...body.matchAll(/writeLibraryRegistry\(/g)].length;
  const guardedSites = [...body.matchAll(/snap\.changed && !dryRun/g)].length;
  assert.ok(writeSites >= 3, `expected at least 3 writeLibraryRegistry sites in handleRefresh, found ${writeSites}`);
  assert.equal(guardedSites, writeSites, `every write site must be guarded by !dryRun (writes=${writeSites}, guarded=${guardedSites})`);
});
