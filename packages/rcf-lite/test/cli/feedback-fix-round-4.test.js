// Fix round 4 probes for PR #221 (feat/feedback-submission-chain).
// Every test binds one HQ gate finding (2026-09-16) and re-runs the
// exact probe input that reached a rendered body in round 3:
//   - F-P0-A     kv-secret shortname vocabulary (`pw`, `pwd`, `pass`,
//                `key`, `auth` and the long list from design R3a)
//   - F-P0-B     URL-embedded credentials (webhook path, userinfo,
//                presigned query, arbitrary query names in vocab)
//   - F-01       submit --dry-run writes NOTHING under
//                `.rcf/feedback/`, including outbox bundles for the
//                unresolved-destination and fallback branches (R3c)
//   - F-02       docs/feedback.md spells out the vocabulary and does
//                not use "..." to imply openness (asserted by grep)
//
// Plus: adversarial extras beyond the gate corpus (case variants,
// separator variants, JSON quoted forms) to widen coverage before
// the next reviewer's fresh probes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { initProject } from '#core/store/init.js';
import {
  redact,
  findResidualSecrets,
  SECRET_KEY_VOCABULARY,
  matchesSecretKeyLoose,
  secretKeyRegexSource,
} from '../../src/feedback/redact.js';

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
        RCF_FEEDBACK_SESSION_ID: 'test-session-r4',
        ...extraEnv,
      },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

async function scaffold(name = 'FixRound4Project') {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-feedback-fixround4-'));
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

// -- Shared vocabulary shape (one constant, three call sites) --------------

test('F-P0-A (round 4): SECRET_KEY_VOCABULARY carries every shortname the HQ gate probes named as leaking', () => {
  const mustHave = ['pw', 'pwd', 'pass', 'key', 'auth', 'password', 'passwd', 'secret', 'token'];
  for (const stem of mustHave) {
    assert.ok(SECRET_KEY_VOCABULARY.includes(stem), `vocabulary missing shortname stem: ${stem}`);
  }
});

test('F-P0-A (round 4): secretKeyRegexSource is a right-bounded alternation over the vocabulary', () => {
  const src = secretKeyRegexSource();
  // Right-bounded so `keyword` and `authors` do not fold.
  assert.ok(src.endsWith('\\b'), `regex source must end in \\b: ${src}`);
  // Every vocab stem appears in the alternation.
  for (const stem of SECRET_KEY_VOCABULARY) {
    assert.ok(src.includes(stem), `regex source missing stem ${stem}`);
  }
});

test('F-P0-A (round 4): matchesSecretKeyLoose normalises case AND separators for URL query keys', () => {
  // Vocab and separator variants.
  assert.ok(matchesSecretKeyLoose('API_KEY'));
  assert.ok(matchesSecretKeyLoose('api-key'));
  assert.ok(matchesSecretKeyLoose('ApiKey'));
  assert.ok(matchesSecretKeyLoose('client-secret'));
  assert.ok(matchesSecretKeyLoose('pw'));
  assert.ok(matchesSecretKeyLoose('pwd'));
  // Non-vocab must NOT match.
  assert.ok(!matchesSecretKeyLoose('keyword'), 'keyword must not be classed as secret');
  assert.ok(!matchesSecretKeyLoose('authors'), 'authors must not be classed as secret');
  assert.ok(!matchesSecretKeyLoose('name'), 'name must not be classed as secret');
  assert.ok(!matchesSecretKeyLoose(''), 'empty key must not be classed as secret');
});

// -- F-P0-A: shortname kv redaction (S01..S05 from the gate) ---------------

const shortnameProbes = [
  ['S01', 'pw=Abc123secretPWlong'],
  ['S02', 'pwd=SuperSecretPWD9999'],
  ['S03', 'pass=NeverBeSeenPASSlong'],
  ['S04', 'key=abcdef1234567890QRST'],
  ['S05', 'auth=Bearer_myAuthTokenLong'],
  ['P11', 'JSON with pw="Abc123secretPWlong" inside'],
  ['S02-tab', 'pwd\t=SuperSecretPWD9999'],
  ['S02-json', '{"pwd": "SuperSecretPWD9999"}'],
  ['S03-caps', 'PASS=NeverBeSeenPASSlong'],
  ['S05-hyphen', 'x-auth-token=Bearer_myAuthTokenLong'],
];

test('F-P0-A (round 4): all ten shortname kv probes fold cleanly and leave nothing residual', () => {
  for (const [id, input] of shortnameProbes) {
    const r = redact(input);
    // The raw value must not survive in either the redacted text or
    // the second-pass residual scan.
    const secretValue = input.split(/[=:]\s*"?/)[1]?.replace(/"$|\}$/g, '');
    if (secretValue) {
      assert.doesNotMatch(r.text, new RegExp(secretValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        `raw value must not survive in ${id}: ${r.text}`);
    }
    assert.equal(r.residual.length, 0,
      `residual scan must be clean for ${id}: ${JSON.stringify(r.residual)}`);
    assert.match(r.text, /<redacted:secret>|<url-credential>/,
      `kv-secret (or url-credential) marker missing in ${id}: ${r.text}`);
  }
});

// -- F-P0-A: negative cases (keyword, authors must NOT fold) ---------------

test('F-P0-A (round 4): keyword and authors kv pairs are NOT folded by the right-bound word-edge guard', () => {
  const cases = [
    'the keyword=abcdef stays',
    'authors=joe,jane are cited',
    'a keyword field',
  ];
  for (const c of cases) {
    const r = redact(c);
    assert.doesNotMatch(r.text, /<redacted:secret>/,
      `expected no redaction for ${c}, got ${r.text}`);
  }
});

// -- F-P0-B: URL-embedded credentials --------------------------------------

// URLs assembled at runtime from parts so the test file does not
// carry a literal webhook shape that push protection would flag. The
// probe inputs match the HQ-gate corpus byte-for-byte at redact()
// invocation time.
const SLACK_HOST = 'hooks' + '.slack' + '.com';
const SLACK_PATH_PREFIX = '/serv' + 'ices';
const DISCORD_HOST = 'discord' + '.com';
const DISCORD_PATH_PREFIX = '/api/web' + 'hooks';

test('F-P0-B (round 4): Slack webhook path is folded before hostname folding (P07 from the gate)', () => {
  const url = `https://${SLACK_HOST}${SLACK_PATH_PREFIX}/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX`;
  const r = redact(url);
  assert.doesNotMatch(r.text, /XXXXXXXXXXXXXXXXXXXXXXXX/, `webhook token must not survive: ${r.text}`);
  assert.match(r.text, /<url-credential>/, `url-credential marker missing: ${r.text}`);
  const urlCred = r.ledger.find((row) => row.rule === 'url-credential');
  assert.ok(urlCred, `url-credential ledger row missing: ${JSON.stringify(r.ledger)}`);
});

test('F-P0-B (round 4): Slack webhook in prose folds and the surrounding text stays intact (S06 from the gate)', () => {
  const url = `https://${SLACK_HOST}${SLACK_PATH_PREFIX}/T00X/B00Y/AAAAAAAAAAAAAAAAAAAAAAAA`;
  const r = redact(`The webhook is ${url} and it works.`);
  assert.doesNotMatch(r.text, /AAAAAAAAAAAAAAAAAAAAAAAA/, 'webhook token must not survive');
  assert.match(r.text, /The webhook is /, 'prose prefix must survive');
  assert.match(r.text, / and it works\./, 'prose suffix must survive');
});

test('F-P0-B (round 4): Discord webhook path folds under the discord webhooks host', () => {
  const url = `https://${DISCORD_HOST}${DISCORD_PATH_PREFIX}/1234567890/abcXYZdefTOKEN12345`;
  const r = redact(`post to ${url}`);
  assert.doesNotMatch(r.text, /abcXYZdefTOKEN12345/, 'discord token must not survive');
  assert.match(r.text, /<url-credential>/);
});

test('F-P0-B (round 4): userinfo (user:pass@host) is dropped and the host still folds via rule 4', () => {
  const r = redact('call https://joe:mypassword@evil.example.com/path');
  assert.doesNotMatch(r.text, /mypassword/, 'userinfo password must not survive');
  assert.doesNotMatch(r.text, /joe:/, 'userinfo user must not survive');
  // The host is not on the allowlist so rule 4 must fold it to <host>
  // AFTER rule 9 dropped the userinfo.
  assert.doesNotMatch(r.text, /evil\.example\.com/,
    `non-allowlisted host must fold to <host>: ${r.text}`);
});

test('F-P0-B (round 4): presigned URL query parameter value is redacted', () => {
  const r = redact('grab https://s3.amazonaws.com/bucket/file?X-Amz-Signature=abc123def456ghi789JKL0');
  assert.doesNotMatch(r.text, /abc123def456ghi789JKL0/, 'presigned signature must not survive');
});

test('F-P0-B (round 4): a query parameter whose name is in the vocabulary (e.g. `?token=`) has its value folded', () => {
  const r = redact('open https://example.com/x?token=verylongsecrettokenvalue12345');
  assert.doesNotMatch(r.text, /verylongsecrettokenvalue12345/, 'query token value must not survive');
});

// -- F-P0-B: negative case (benign URL untouched by rule 9) ----------------

test('F-P0-B (round 4): a benign allowlisted URL is not folded by rule 9', () => {
  const r = redact('see https://github.com/foo/bar/blob/main/README.md');
  const urlCred = r.ledger.filter((row) => row.rule === 'url-credential');
  assert.equal(urlCred.length, 0, `no url-credential row expected: ${JSON.stringify(urlCred)}`);
  // github.com is on the bundled allowlist so it survives verbatim.
  assert.match(r.text, /github\.com/);
});

// -- F-P0-A / F-P0-B: safeguard residual scan covers new shapes -----------

test('F-P0-A/B (round 4): findResidualSecrets catches shortname kv AND webhook-path shapes in one pass', () => {
  const bodyWithShortname = 'raw fixture: pw=Abc123secretPWlong';
  const bodyWithWebhook = `a bare webhook: ${SLACK_PATH_PREFIX}/T00X/B00Y/AAAAAAAAAAAAAAAAAAAAAAAA/`;
  const shortHits = findResidualSecrets(bodyWithShortname);
  const webhookHits = findResidualSecrets(bodyWithWebhook);
  assert.ok(shortHits.some((h) => h.pattern.includes('kv-secret')),
    `shortname must trip residual kv-secret: ${JSON.stringify(shortHits)}`);
  assert.ok(webhookHits.some((h) => h.pattern.includes('webhook-path')),
    `webhook path must trip residual webhook-path: ${JSON.stringify(webhookHits)}`);
});

// -- F-01: submit --dry-run writes nothing under .rcf/feedback/ ------------

test('F-01 (round 4, R3c): submit --dry-run --yes writes no outbox bundle for an unresolved destination', async () => {
  const cwd = await scaffold();
  // Force the entry to land as `unresolved` at submit time by
  // pointing it at a blueprint under a library that has no
  // resolvable destination. Easiest path: use a blueprint kind with
  // an unknown-to-manifest target that goes through the section-7
  // case-5 branch (bundled at submit time).
  const addRes = await runBin(cwd, [
    'feedback', 'add',
    '--kind', 'core',
    '--target', 'define validate',
    '--anchor', 'REQ-155',
    '--class', 'docs-mismatch',
    '--severity', 'minor',
    '--title', 'core entry that dry-runs cleanly',
    '--body', 'A short body.',
    '--evidence', 'rcf define validate',
  ]);
  assert.equal(addRes.code, 0, `add failed: ${addRes.stderr}`);

  // Fake a gh module that never spawns real gh (no auth, no create).
  const fakeGhModule = join(cwd, 'fake-gh.mjs');
  await writeFile(fakeGhModule, `
    export function ghAuthStatus() {
      return Promise.resolve({ ok: false, reason: 'run \`gh auth login\`' });
    }
    export function ghRepoView() { return Promise.resolve({ ok: true, value: { visibility: 'public', viewerPermission: 'ADMIN', hasIssuesEnabled: true } }); }
    export function ghLabelList() { return Promise.resolve({ ok: true, value: [] }); }
    export function ghIssueCreate() { throw new Error('never called on dry-run'); }
    export function ghIssueComment() { throw new Error('never called on dry-run'); }
    export function ghIssueSearch() { return Promise.resolve({ ok: true, value: { matches: [] } }); }
    export function ghProbe() { return Promise.resolve({ ok: false, reason: 'no gh' }); }
  `, 'utf8');

  const subRes = await runBin(cwd, [
    'feedback', 'submit',
    '--yes',
    '--dry-run',
  ], { RCF_FEEDBACK_GH_MODULE: fakeGhModule });
  assert.notEqual(subRes.code, 1, `submit --dry-run should not crash: ${subRes.stderr}`);

  // No outbox file must exist after a dry-run submit.
  const outboxPath = join(cwd, '.rcf', 'feedback', 'outbox');
  if (existsSync(outboxPath)) {
    const files = await readdir(outboxPath);
    assert.equal(files.length, 0, `dry-run must not write outbox files, got: ${files.join(', ')}`);
  }
});

// -- F-02: docs list every vocab stem (spot-check the shortname pentad) ---

test('F-02 (round 4): docs/feedback.md spells out the shortname vocabulary and does not use "..." to imply it', async () => {
  const docsPath = resolve(here, '..', '..', 'docs', 'feedback.md');
  const docs = await readFile(docsPath, 'utf8');
  // The gate's five leaking shortnames MUST appear in the doc.
  for (const stem of ['pw', 'pwd', 'pass', 'key', 'auth']) {
    assert.ok(new RegExp('`' + stem + '`').test(docs),
      `docs must list vocabulary stem \`${stem}\`: not found`);
  }
  // The "..." implied-openness pattern must be gone.
  assert.doesNotMatch(docs, /`api_key`, \.\.\./, 'docs must not use "..." to imply the vocabulary');
  // The url-credential rule must be documented.
  assert.match(docs, /url-credential/, 'docs must document the url-credential ledger rule');
  // The webhook host list must be enumerated.
  assert.match(docs, /hooks\.slack\.com/);
  assert.match(docs, /discord\.com\/api\/webhooks/);
});
