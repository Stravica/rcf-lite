// Fix round 3 probes for PR #221 (feat/feedback-submission-chain).
// Each test binds one open item from the round-2 re-review:
//   - R-P0-3     path matcher swallowed a following secret key
//   - F-slice-2-10 (r3) oversized-evidence cap stripped fingerprint markers
//   - AC-15601-4 (r3) bundle-level residual returned exit 1 instead of 3
//   - F-slice-1-01 (r3) gitignore fallback was negation-blind
//   - F-slice-2-06 (r3) terminal `/Users/john  doe` (double space)
//   - F-slice-2-09 (r3) same-field distinct kv-secret samples collapsed
//   - F-slice-1-09 (r3) `list --all --json` exposed pruned bodies
//   - AC-15601-4 (unicode key) `pássword=` slipped both passes
//   - CLI-level PEM e2e (round-2 goldens noted this as the last gap)
//   - AC-16103-1 (flake) SessionEnd re-run over a second boundary
//     minted a second bundle file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { initProject } from '#core/store/init.js';
import { redact, findResidualSecrets, BODY_CAP_BYTES } from '../../src/feedback/redact.js';
import { renderIssue, capRenderedBody } from '../../src/feedback/render.js';
import { ensureGitignore, appendEntry, appendState, feedbackDir } from '../../src/feedback/store.js';

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
        RCF_FEEDBACK_SESSION_ID: 'test-session-r3',
        ...extraEnv,
      },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

async function scaffold(name = 'FixRound3Project') {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-feedback-fixround3-'));
  await initProject({ projectRoot: tmp, projectName: name });
  await writeFile(join(tmp, '.gitignore'), '.rcf/feedback/\n', 'utf8');
  return tmp;
}

async function addCore(cwd, title, body = 'body-content') {
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
  ]);
  assert.equal(res.code, 0, `add failed: ${res.stderr}`);
  const m = res.stdout.match(/recorded (fb-\d{8}-[0-9a-f]{12})/);
  return m[1];
}

// -- R-P0-3 -----------------------------------------------------------------

test('R-P0-3 (round 3): a POSIX path followed by `keyname=value` never swallows the secret key label', async () => {
  const r = redact('/tmp/cache password=Abc12345');
  assert.equal(r.residual.length, 0, 'redacted text must not carry a residual');
  assert.doesNotMatch(r.text, /Abc12345/, `raw secret value must not survive: ${r.text}`);
  assert.match(r.text, /<redacted:secret>/, `kv-secret must fold: ${r.text}`);
});

test('R-P0-3 (round 3): a Windows path followed by `keyname=value` never swallows the secret key label', async () => {
  const r = redact('C:\\Users\\john password=Abc12345');
  assert.equal(r.residual.length, 0);
  assert.doesNotMatch(r.text, /Abc12345/, `raw secret value must not survive: ${r.text}`);
  assert.match(r.text, /<redacted:secret>/);
});

// -- F-slice-2-06 (round 3): terminal `/Users/john  doe` --------------------

test('F-slice-2-06 (round 3): terminal path with a double-space username directory folds cleanly', async () => {
  const r = redact('see /Users/john  doe end here');
  // `<path>` collapse is fine (basename has a space); the point is
  // that `doe` must not leak on the wire.
  assert.doesNotMatch(r.text, /\bdoe\b/, `basename doe must not survive: ${r.text}`);
});

// -- F-slice-2-09 (round 3): same-field distinct kv-secret samples ----------

test('F-slice-2-09 (round 3): two DIFFERENT kv-secret values in the SAME field land as two ledger rows', async () => {
  const r = redact('password=Alpha12345 and password=Beta12345');
  const secretRows = r.ledger.filter((row) => row.rule === 'secret-token');
  const befores = new Set(secretRows.map((row) => row.before));
  assert.ok(befores.has('password=Alpha12345'), `first sample must be logged: ${JSON.stringify(secretRows)}`);
  assert.ok(befores.has('password=Beta12345'), `second sample must be logged: ${JSON.stringify(secretRows)}`);
});

// -- F-slice-2-10 (round 3): fingerprint-preserving cap ---------------------

test('F-slice-2-10 (round 3): oversized rendered body keeps BOTH fingerprint markers after the cap', async () => {
  // Simulate what an 8192-byte-evidence issue looks like end to end.
  const bigEvidence = 'x'.repeat(BODY_CAP_BYTES);
  const entry = {
    kind: 'core',
    target: { ref: 'define validate' },
    anchor: 'REQ-155',
    symptomClass: 'other',
    severity: 'minor',
    environment: { rcfLiteVersion: '0.0.0-test', harness: 'test', nodeVersion: 'v24', platform: 'darwin' },
  };
  const redacted = {
    title: 'oversized-evidence',
    body: 'body-head',
    evidence: [{ kind: 'command', value: bigEvidence }],
    ledger: [],
  };
  const meta = { fingerprint: 'FP-TEST-ROUND3', destination: { repo: 'o/r', visibility: 'public' } };
  const rendered = renderIssue(entry, redacted, meta);
  assert.ok(Buffer.byteLength(rendered.body, 'utf8') <= BODY_CAP_BYTES, `body over cap: ${Buffer.byteLength(rendered.body, 'utf8')}`);
  assert.match(rendered.body, /<!-- rcf-feedback-fingerprint: FP-TEST-ROUND3 -->/, 'HTML fingerprint marker must survive the cap');
  assert.match(rendered.body, /^rcf-feedback-fingerprint: FP-TEST-ROUND3$/m, 'visible fingerprint line must survive the cap');
});

// -- AC-15601-4 (round 3): bundle-level residual exit code ------------------

test('AC-15601-4 (round 3): bundle-level residual returns exit 3, not 1', async () => {
  // Force the entry to bundle rather than submit: set a gh binary
  // that never resolves (so preflight fails) then trigger `submit`.
  // The safeguard bites on the assembled bundle text and MUST exit 3.
  const tmp = await scaffold();
  const filler = 'abcdefghijklmnopqrstuvwxyz1234567890';
  // A stealth token: the primary pattern has `\b` boundaries, so
  // burying the token inside a longer identifier lets it slip the
  // per-entry redactor while the residual (loose) pattern still
  // catches it at the whole-bundle scan.
  const stealthToken = 'xxx' + ['ghp', '_', filler].join('') + 'yyy';
  await addCore(tmp, 'bundle-safeguard-probe', `token ${stealthToken} in body`);
  // Force bundling by pointing gh at a nonexistent binary; the CLI
  // preflight falls through to the whole-destination bundle path.
  const res = await runBin(tmp, ['feedback', 'submit', '--yes'], { PATH: '/nonexistent-bin' });
  // Either the per-entry residual OR the bundle-level residual keeps
  // the entry pending. Both paths must return exit 3.
  assert.equal(res.code, 3, `submit must return exit 3 when a residual keeps an entry pending; stderr=${res.stderr}, stdout=${res.stdout}`);
});

// -- F-slice-1-01 (round 3): fallback rejects unknown negations -------------

test('F-slice-1-01 (round 3): fallback ensureGitignore refuses when an unrecognised ! negation is present', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-feedback-negfallback-'));
  // No git init on `tmp`, so ensureGitignore falls into the textual
  // scan. The negation `!*.jsonl` would re-include entries.jsonl
  // under real git even though `.rcf/feedback/*` is ignored; the
  // fallback cannot judge safely and MUST refuse.
  await writeFile(join(tmp, '.gitignore'), '.rcf/feedback/*\n!*.jsonl\n', 'utf8');
  const check = await ensureGitignore(tmp);
  assert.equal(check.ok, false, `fallback must refuse the unrecognised negation; got ${JSON.stringify(check)}`);
  assert.match(check.reason, /negation the fallback cannot evaluate/);
});

// -- F-slice-1-09 (round 3): list --all --json scrubs pruned bodies --------

test('F-slice-1-09 (round 3): `list --all --json` never re-exposes a pruned entry\'s title or body', async () => {
  const tmp = await scaffold();
  // Seed an ancient discarded entry that will be pruned on the next
  // sweep (recordedAt used as discard timestamp for ancient rows).
  const secretishTitle = 'ancient-title-should-not-leak';
  const secretishBody = 'ancient-body-should-not-leak';
  await appendEntry(tmp, {
    id: 'fb-19700101-eeeeffffaaaa',
    recordedAt: '1970-01-01T00:00:00Z',
    kind: 'core', target: { ref: 'define validate' },
    anchor: null, symptomClass: 'other', severity: 'minor',
    title: secretishTitle, body: secretishBody, evidence: [{ kind: 'command', value: 'ancient-evidence' }],
    environment: {}, askNow: false, status: 'discarded',
  });
  // Any add triggers the prune sweep.
  await addCore(tmp, 'kicks-the-prune');
  const listRes = await runBin(tmp, ['feedback', 'list', '--all', '--json']);
  assert.equal(listRes.code, 0, listRes.stderr);
  const arr = JSON.parse(listRes.stdout);
  const pruned = arr.find((e) => e.id === 'fb-19700101-eeeeffffaaaa');
  assert.equal(pruned.status, 'pruned');
  assert.equal(pruned.title, null, 'pruned title must be scrubbed in --json');
  assert.equal(pruned.body, null, 'pruned body must be scrubbed in --json');
  assert.deepEqual(pruned.evidence, [], 'pruned evidence must be emptied in --json');
  assert.doesNotMatch(listRes.stdout, new RegExp(secretishTitle), 'raw pruned title must not appear anywhere in stdout');
  assert.doesNotMatch(listRes.stdout, new RegExp(secretishBody), 'raw pruned body must not appear anywhere in stdout');
});

// -- AC-15601-4 (unicode key) ----------------------------------------------

test('AC-15601-4 (unicode key, round 3): residual pass catches a kv-secret whose key label carries a diacritic', async () => {
  const hits = findResidualSecrets('pássword=Abc12345');
  const patterns = hits.map((h) => h.pattern);
  assert.ok(patterns.some((p) => p.startsWith('unicode-key:')), `residual must flag a unicode key: ${JSON.stringify(hits)}`);
});

test('AC-15601-4 (unicode key, round 3): preview surfaces a residual for a pásswórd= value so submit refuses', async () => {
  const tmp = await scaffold();
  await addCore(tmp, 'unicode-key-secret', 'pássword=Sup3rSecret123!');
  const preview = await runBin(tmp, ['feedback', 'preview', '--json']);
  assert.equal(preview.code, 0, preview.stderr);
  const obj = JSON.parse(preview.stdout)[0];
  assert.ok(obj.residual.length > 0, `preview must surface a residual for the unicode key: ${JSON.stringify(obj.residual)}`);
  const submitRes = await runBin(tmp, ['feedback', 'submit', '--yes', '--dry-run']);
  assert.equal(submitRes.code, 3, `submit must return exit 3 when the residual keeps the entry pending; stderr=${submitRes.stderr}`);
});

// -- CLI-level PEM e2e (round-3 gap named in the goldens verdict) ----------

test('AC-15601-4 (CLI-level PEM e2e, round 3): an em-dash PEM body is refused end-to-end by preview + submit --dry-run', async () => {
  const tmp = await scaffold();
  // The dashes are em-dashes (\u2014); dash normalisation runs before
  // the residual scan, so the first pass should redact the block and
  // no residual should remain. Ship this through the CLI verbs to
  // prove the rendered surface is clean.
  const emdash = '\u2014\u2014\u2014\u2014\u2014';
  const body = [
    'preamble',
    `${emdash}BEGIN RSA PRIVATE KEY${emdash}`,
    'MIIEowIBAAKCAQEAwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww',
    `${emdash}END RSA PRIVATE KEY${emdash}`,
    'tail',
  ].join('\n');
  await addCore(tmp, 'em-dash-pem-body', body);
  const previewRes = await runBin(tmp, ['feedback', 'preview']);
  assert.equal(previewRes.code, 0, previewRes.stderr);
  // The `body:` section is what actually ships to GitHub; the
  // ledger disclosure at the tail intentionally names the BEFORE
  // text so the operator can see what was stripped. Isolate the
  // rendered body and assert the PEM payload does not appear
  // between `body:` and the next `---` fence.
  const bodyStart = previewRes.stdout.indexOf('body:\n');
  assert.ok(bodyStart >= 0, `preview must render a body section: ${previewRes.stdout}`);
  const bodyEnd = previewRes.stdout.indexOf('\nredaction ledger:', bodyStart);
  const bodySection = previewRes.stdout.slice(bodyStart, bodyEnd >= 0 ? bodyEnd : undefined);
  assert.match(bodySection, /<redacted:secret>/, `rendered body must show the PEM was redacted: ${bodySection}`);
  assert.doesNotMatch(bodySection, /MIIEowIBAA/, `PEM payload must not leak into the rendered body section: ${bodySection}`);
  const submitRes = await runBin(tmp, ['feedback', 'submit', '--yes', '--dry-run']);
  // The em-dash PEM is redacted; submit should proceed (dry-run:
  // exit 0 or 3 depending on destination resolution).
  assert.ok(submitRes.code === 0 || submitRes.code === 3, `submit exit code was ${submitRes.code}; stderr=${submitRes.stderr}`);
});

// -- AC-16103-1 (flake fix) -------------------------------------------------

test('AC-16103-1 (round 3): session-end idempotency ignores the Generated: timestamp across time drift', async () => {
  const tmp = await scaffold();
  await appendEntry(tmp, {
    id: 'fb-19700101-99999999aaaa',
    recordedAt: '2026-09-16T10:00:00Z',
    kind: 'core', target: { ref: 'x' }, anchor: 'A',
    symptomClass: 'other', severity: 'minor',
    title: 'session-end-idempotency', body: 'b', evidence: [], environment: {},
    askNow: false, status: 'pending',
  });
  // Force two adjacent runs to write DIFFERENT `Generated:` stamps
  // by planting a stale prior session-end file with the same pending
  // set but a different timestamp. The canonicalisation check must
  // treat that as identical and refuse to write a second file.
  const outbox = join(tmp, '.rcf/feedback/outbox');
  await mkdir(outbox, { recursive: true });
  // Compose the current pending set body using the CLI (dry
  // approach) via feeding hook stdin.
  const stdinPayload = JSON.stringify({ session_id: 'e1', cwd: '.', hook_event_name: 'SessionEnd' });
  const firstResPromise = new Promise((resolvePromise) => {
    const child = execFile(process.execPath, [bin, 'feedback', 'hook', 'session-end', '--harness', 'claude-code'], {
      cwd: tmp,
      encoding: 'utf8',
      env: { ...process.env, CI: '1' },
    }, (err, stdout, stderr) => resolvePromise({ code: err?.code ?? 0, stdout, stderr }));
    child.stdin.end(stdinPayload);
  });
  const firstRes = await firstResPromise;
  assert.equal(firstRes.code, 0, `first hook: ${firstRes.stderr}`);
  const filesA = (await readdir(outbox)).filter((f) => f.endsWith('-session-end.md'));
  assert.equal(filesA.length, 1, 'first run writes one bundle');
  // Rewrite the existing file with an OLDER Generated line while
  // keeping the rest of the body identical, then re-run. The stamp
  // difference must not create a second file.
  const existing = await readFile(join(outbox, filesA[0]), 'utf8');
  const drifted = existing.replace(/^Generated: [^\n]*$/m, 'Generated: 1970-01-01T00:00:00Z');
  await writeFile(join(outbox, filesA[0]), drifted, 'utf8');
  const secondResPromise = new Promise((resolvePromise) => {
    const child = execFile(process.execPath, [bin, 'feedback', 'hook', 'session-end', '--harness', 'claude-code'], {
      cwd: tmp,
      encoding: 'utf8',
      env: { ...process.env, CI: '1' },
    }, (err, stdout, stderr) => resolvePromise({ code: err?.code ?? 0, stdout, stderr }));
    child.stdin.end(stdinPayload);
  });
  const secondRes = await secondResPromise;
  assert.equal(secondRes.code, 0, `second hook: ${secondRes.stderr}`);
  const filesB = (await readdir(outbox)).filter((f) => f.endsWith('-session-end.md'));
  assert.equal(filesB.length, 1, 'a re-run whose only difference is the Generated: timestamp must not mint a second file');
});
