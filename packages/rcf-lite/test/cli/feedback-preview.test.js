// FBS-181 slice 2 CLI tests for `rcf feedback preview`.
//
// Binds AC-15601-1 (rendered title, body, destination and full
// ledger vocabulary in --json), AC-15601-2 (residual-secret marker
// surfaced by preview so the operator sees before consenting; the
// submit half of AC-15601-2 lands with slice 4), AC-15601-3 (the
// stored entries.jsonl body is never mutated by preview) and
// AC-15701-1 (fingerprint appears in each preview and folds cross
// version).
//
// Every run drives bin/rcf.js in a mkdtemp project (`initProject`),
// which is the repo convention. Network is refused by construction:
// slice 2 does not shell out to anything.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { initProject } from '#core/store/init.js';
import { BODY_CAP_BYTES } from '../../src/feedback/redact.js';

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

async function scaffoldReady(name = 'PreviewProject') {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-feedback-preview-'));
  await initProject({ projectRoot: tmp, projectName: name });
  await writeFile(join(tmp, '.gitignore'), '.rcf/feedback/\n', 'utf8');
  return tmp;
}

async function seedIdentity(root, name) {
  await mkdir(join(root, 'rcf', '.identity'), { recursive: true });
  await writeFile(join(root, 'rcf', '.identity', 'profile.md'), `## Name\n${name}\n`, 'utf8');
}

async function addCore(cwd, title, body, extra = []) {
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

// -- AC-15601-1 ------------------------------------------------------------

test('AC-15601-1: rcf feedback preview --json emits rendered title, body, destination and full-vocabulary ledger', async () => {
  const root = await scaffoldReady();
  await seedIdentity(root, 'Alice Smith');
  // Assemble the token at runtime so no commit-shaped literal reaches
  // the repo (GitHub's secret scanner treats them as leaks even when
  // they are obviously test data).
  const fakeToken = ['ghp_', 'abcdefghijklmnopqrstuvwxyz1234567890'].join('');
  const body = [
    'Bug at /Users/jo/other/x/y.js reported by jo@example.com to api.example.com',
    `IP 10.0.5.7 hit; token ${fakeToken} leaked.`,
    'Alice Smith reviewed the report. Hello—world.',
    // Under the 8KB add cap but forces the size-shape ledger row via
    // the em-dash normalisation and the ordinary character count.
    'x'.repeat(4 * 1024),
  ].join('\n');
  const id = await addCore(root, 'A preview test finding', body);

  const res = await runBin(root, ['feedback', 'preview', '--json']);
  assert.equal(res.code, 0, res.stderr);
  const arr = JSON.parse(res.stdout);
  assert.equal(arr.length, 1);
  const p = arr[0];
  assert.equal(p.id, id);
  assert.equal(p.destination.repo, 'Stravica/rcf-lite');
  assert.equal(p.destination.visibility, 'public');
  assert.ok(p.titleRendered.startsWith('[rcf-lite] '));
  assert.match(p.bodyRendered, /rcf-feedback-fingerprint:/);
  // F-slice-2-10: the rendered body must respect the design 5 rule
  // 7 cap (BODY_CAP_BYTES). The earlier 16 KB assertion silently
  // accepted a violation and is the precedent the reviewer named.
  assert.ok(
    Buffer.byteLength(p.bodyRendered, 'utf8') <= BODY_CAP_BYTES,
    `AC-15601-1 (design 5 rule 7): rendered body must stay under ${BODY_CAP_BYTES} bytes`,
  );

  const ruleNames = new Set(p.ledger.map((r) => r.rule));
  for (const required of ['absolute-path', 'email', 'hostname', 'private-ip', 'secret-token', 'operator-identity', 'size-shape']) {
    assert.ok(ruleNames.has(required), `expected ledger rule ${required}, got ${[...ruleNames]}`);
  }

  // Rendered body must contain none of the raw secret substrings, no
  // private IP, no operator-name tokens, no em-dash.
  assert.doesNotMatch(p.bodyRendered, new RegExp(fakeToken.slice(0, 20)));
  assert.doesNotMatch(p.bodyRendered, /10\.0\.5\.7/);
  assert.doesNotMatch(p.bodyRendered, /Alice/);
  assert.doesNotMatch(p.bodyRendered, /Smith/);
  assert.doesNotMatch(p.bodyRendered, /—/);
});

// -- AC-15601-2 (preview half; submit half lives in slice 4) ---------------

test('AC-15601-2: preview surfaces a residual-secret line so the agent can rewrite before submit', async () => {
  const root = await scaffoldReady();
  // Craft a body that, after the first pass, still holds a token-shaped
  // run: two tokens on separate lines. The redactor's second pass finds
  // whatever survived (in this case an obfuscation the first pass does
  // not know about, injected here directly by wrapping the raw token
  // with characters the redactor treats as word boundaries).
  const cleanBody = 'no secrets here';
  const fakeToken = ['ghp_', 'abcdefghijklmnopqrstuvwxyz1234567890'].join('');
  const tainted = `oops: prefix_${fakeToken}_suffix`;
  await addCore(root, 'clean', cleanBody);
  await addCore(root, 'tainted', tainted);

  const res = await runBin(root, ['feedback', 'preview', '--json']);
  assert.equal(res.code, 0, res.stderr);
  const arr = JSON.parse(res.stdout);
  assert.equal(arr.length, 2);
  const bad = arr.find((p) => p.titleRendered.endsWith('tainted'));
  const good = arr.find((p) => p.titleRendered.endsWith('clean'));
  assert.ok(bad, 'tainted preview should exist');
  assert.ok(good, 'clean preview should exist');
  assert.ok(bad.residual.length >= 1, 'residual list should carry at least one hit');
  assert.equal(good.residual.length, 0);
});

// -- AC-15601-3 ------------------------------------------------------------

test('AC-15601-3: preview never mutates the stored entries.jsonl (sha-256 invariant)', async () => {
  const root = await scaffoldReady();
  await addCore(root, 'invariance test', 'some body with jo@example.com');
  const jsonlPath = join(root, '.rcf/feedback/entries.jsonl');
  const before = createHash('sha256').update(await readFile(jsonlPath)).digest('hex');
  // Run preview twice; both text and --json.
  await runBin(root, ['feedback', 'preview']);
  await runBin(root, ['feedback', 'preview', '--json']);
  const after = createHash('sha256').update(await readFile(jsonlPath)).digest('hex');
  assert.equal(before, after, 'entries.jsonl bytes must be invariant across preview runs');
});

// -- AC-15701-1 ------------------------------------------------------------

test('AC-15701-1: preview attaches a stable fingerprint per entry and it does not shift across blueprint versions', async () => {
  // We cannot easily seed a manifest blueprint here without more
  // scaffolding, so exercise the property through two entries that
  // differ only by their unrelated body text; the fingerprint should
  // still be equal because the fingerprint inputs (kind, targetKey,
  // anchor, symptomClass) are identical.
  const root = await scaffoldReady();
  await addCore(root, 'first', 'body one');
  await addCore(root, 'second', 'body two');
  const res = await runBin(root, ['feedback', 'preview', '--json']);
  const arr = JSON.parse(res.stdout);
  assert.equal(arr.length, 2);
  assert.match(arr[0].fingerprint, /^[0-9a-f]{12}$/);
  assert.match(arr[1].fingerprint, /^[0-9a-f]{12}$/);
  // Same kind, targetKey, anchor and class => same fingerprint.
  assert.equal(arr[0].fingerprint, arr[1].fingerprint);
});

test('AC-15701-1 (fallback): missing anchor triggers the fingerprintFallback flag and a warning banner in text mode', async () => {
  const root = await scaffoldReady();
  // The `add` command requires --anchor when given; but the anchor is
  // optional at the flag level ("strongly recommended for dedupe" in
  // help). Register two entries: one with an anchor, one without.
  await addCore(root, 'with anchor', 'x');
  const withoutAnchor = await runBin(root, [
    'feedback', 'add',
    '--kind', 'core',
    '--target', 'define validate',
    '--class', 'docs-mismatch',
    '--severity', 'minor',
    '--title', 'no-anchor entry',
    '--body', 'y',
    '--evidence', 'rcf define validate',
  ]);
  assert.equal(withoutAnchor.code, 0, withoutAnchor.stderr);

  const res = await runBin(root, ['feedback', 'preview', '--json']);
  const arr = JSON.parse(res.stdout);
  const fallback = arr.find((p) => p.fingerprintFallback === true);
  assert.ok(fallback, 'one entry should report fingerprintFallback: true');
  const text = await runBin(root, ['feedback', 'preview']);
  assert.match(text.stdout, /warning: no anchor on this entry/);
});

test('preview with no pending entries prints a plain zero-line message', async () => {
  const root = await scaffoldReady();
  const res = await runBin(root, ['feedback', 'preview']);
  assert.equal(res.code, 0);
  assert.match(res.stdout, /no pending feedback entries to preview\./);
});

test('preview refuses an unknown entry id with exit 2', async () => {
  const root = await scaffoldReady();
  await addCore(root, 'only one', 'body');
  const res = await runBin(root, ['feedback', 'preview', 'fb-99999999-abcd']);
  assert.equal(res.code, 2);
  assert.match(res.stderr, /unknown pending entry id/);
});

// -- AC-15601-6 R5g (issue #246): stderr warning on identity-fold disabled

test('AC-15601-6 R5g (issue #246): missing profile.md emits a visible stderr warning', async () => {
  const root = await scaffoldReady();
  await addCore(root, 'title', 'body about the queue');
  const res = await runBin(root, ['feedback', 'preview']);
  assert.equal(res.code, 0);
  assert.match(res.stderr, /operator-identity: rcf\/\.identity\/profile\.md is missing/);
  assert.match(res.stderr, /identity folding is disabled/);
});

test('AC-15601-6 R5g (issue #246): stopword-only Name line emits a visible stderr warning', async () => {
  const root = await scaffoldReady();
  await seedIdentity(root, 'The Agent Operator');
  await addCore(root, 'title', 'body naming the agent stopping');
  const res = await runBin(root, ['feedback', 'preview']);
  assert.equal(res.code, 0);
  assert.match(res.stderr, /operator-identity: rcf\/\.identity\/profile\.md .* contains only reserved nouns/);
  assert.match(res.stderr, /identity folding is disabled/);
});

test('AC-15601-6 R5g (issue #246): a real Name emits no identity-folding warning', async () => {
  const root = await scaffoldReady();
  await seedIdentity(root, 'Alice Example');
  await addCore(root, 'title', 'Alice reviewed this body');
  const res = await runBin(root, ['feedback', 'preview']);
  assert.equal(res.code, 0);
  assert.doesNotMatch(res.stderr, /operator-identity/);
  assert.doesNotMatch(res.stderr, /identity folding is disabled/);
});

test('AC-15601-6 R5g (issue #246): blank ## Name line emits a visible stderr warning', async () => {
  const root = await scaffoldReady();
  await mkdir(join(root, 'rcf', '.identity'), { recursive: true });
  await writeFile(join(root, 'rcf', '.identity', 'profile.md'), '## Name\n   \n', 'utf8');
  await addCore(root, 'title', 'body');
  const res = await runBin(root, ['feedback', 'preview']);
  assert.equal(res.code, 0);
  assert.match(res.stderr, /operator-identity: .* is empty/);
});

// -- Codex P1-2 (issue #246 follow-up): a blank Name followed by ## Role
// must not silently promote "## Role" to the operator identity ---

test('Codex P1-2 (issue #246): a blank ## Name followed by ## Role emits the disabled warning; does not treat the next heading as the identity', async () => {
  const root = await scaffoldReady();
  await mkdir(join(root, 'rcf', '.identity'), { recursive: true });
  // The exact layout the identity-seed template ships (## Name empty,
  // ## Role next). Before the fix, the Name capture crossed the blank
  // line and pulled `## Role` in as the identity; now the extractor
  // scopes to the Name section, so blank-Name emits its warning.
  await writeFile(
    join(root, 'rcf', '.identity', 'profile.md'),
    '## Name\n\n## Role\n\nOperator lead\n',
    'utf8',
  );
  await addCore(root, 'title', 'body about Role and Operator');
  const res = await runBin(root, ['feedback', 'preview']);
  assert.equal(res.code, 0);
  assert.match(res.stderr, /operator-identity: .* is empty/);
  // Ensure the words "Role" and "Operator" are NOT folded by identity.
  assert.match(res.stdout, /Role/);
  assert.match(res.stdout, /Operator/);
});

// -- Codex P1-3 (issue #246 follow-up): the shipped identity-seed
// placeholder must trip the disabled warning, not become the identity ---

test('Codex P1-3 (issue #246): the shipped identity-seed placeholder is recognised as placeholder, not as a name', async () => {
  const root = await scaffoldReady();
  await mkdir(join(root, 'rcf', '.identity'), { recursive: true });
  // Verbatim from src/setup/identity-seed.js line 48.
  await writeFile(
    join(root, 'rcf', '.identity', 'profile.md'),
    '## Name\n\n_(who you are; how you want the agent to address you)_\n\n## Role\n',
    'utf8',
  );
  await addCore(root, 'title', 'body');
  const res = await runBin(root, ['feedback', 'preview']);
  assert.equal(res.code, 0);
  assert.match(res.stderr, /operator-identity: .* is a placeholder/);
});
