// FBS-181 slice 2 unit tests for src/feedback/redact.js.
//
// Fixture corpus covers all eight rule names in the ledger vocabulary
// (project-root, absolute-path, email, hostname, private-ip,
// secret-token, operator-identity, size-shape) plus the rule-8b
// residual-secret refusal and the sha survival exception.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { redact, findResidualSecrets, allowedHosts, BODY_CAP_BYTES } from '../../src/feedback/redact.js';

test('redact rule 1: project root becomes <project> and paths under it keep their tail', () => {
  const { text, ledger } = redact('build failed at /Users/jo/proj/src/app.js line 12', {
    projectRoot: '/Users/jo/proj',
  });
  assert.match(text, /<project>\/src\/app\.js/);
  const row = ledger.find((r) => r.rule === 'project-root');
  assert.ok(row, 'project-root ledger row expected');
  assert.equal(row.after, '<project>');
});

test('redact rule 2: absolute paths outside the project keep basename only', () => {
  const { text, ledger } = redact('config at /Users/other/x/y.json and C:\\Users\\pete\\z.log', {});
  assert.match(text, /<path>\/y\.json/);
  assert.match(text, /<path>\\z\.log/);
  const rows = ledger.filter((r) => r.rule === 'absolute-path');
  assert.equal(rows.length, 2);
});

test('redact rule 3: emails collapse to <email>', () => {
  const { text, ledger } = redact('write to jo@example.com or ops@wsd.example', {});
  assert.equal(text, 'write to <email> or <email>');
  const row = ledger.find((r) => r.rule === 'email');
  assert.equal(row.count, 2);
});

test('redact rule 4: non-allowlisted hostnames collapse; github.com survives', () => {
  const { text, ledger } = redact('see https://github.com/foo/bar and https://api.evil.example/v2/x', {});
  assert.match(text, /https:\/\/github\.com\/foo\/bar/);
  assert.match(text, /<host>\/v2\/x/);
  const row = ledger.find((r) => r.rule === 'hostname');
  assert.equal(row.count, 1);
});

test('redact rule 4b: bare hostnames off-allowlist collapse', () => {
  const { text } = redact('reach api.evil.example on port 443', {});
  assert.match(text, /<host>/);
});

test('redact rule 4c: project-scoped allowHosts extend the vendor list', () => {
  const { text } = redact('see https://internal.wsd.example/x', { allowHosts: ['wsd.example'] });
  assert.match(text, /https:\/\/internal\.wsd\.example\/x/);
});

test('redact rule 5: private and link-local IPs become <ip>, loopback survives', () => {
  const { text, ledger } = redact('bind 10.0.5.7 and 192.168.1.1 and 169.254.1.1; keep 127.0.0.1', {});
  assert.match(text, /<ip>/);
  assert.match(text, /127\.0\.0\.1/);
  assert.doesNotMatch(text, /10\.0\.5\.7/);
  assert.doesNotMatch(text, /192\.168\.1\.1/);
  const row = ledger.find((r) => r.rule === 'private-ip');
  assert.ok(row);
  assert.ok(row.count >= 3);
});

test('redact rule 6: secret-shaped tokens become <redacted:secret>', () => {
  // Build each fixture at runtime so the raw shape never appears as a
  // committed literal in this file (GitHub's secret scanner treats
  // check-in-shaped strings as leak candidates even when they are
  // obvious test data).
  const filler = 'abcdefghijklmnopqrstuvwxyz1234567890';
  const cases = [
    ['ghp_', filler].join(''),
    ['gho_', filler].join(''),
    ['github', '_pat_', 'abcdefghijklmnop_1234567890abcdefghij'].join(''),
    ['AK', 'IA', 'AB', 'CD', 'EFGH', 'IJK', 'LMN', 'OP'].join(''),
    ['sk_', 'live_', filler.slice(0, 20)].join(''),
    ['sk-', filler.slice(0, 20)].join(''),
    ['xoxb', '-', '1234567890', '-', 'abcdefghij'].join(''),
    ['eyJ', 'hbGciOiJIUzI1NiIs', '.', 'eyJ', 'zdWIiOiIxMjM0NTY', '.', 'abcdefghijklmnop'].join(''),
    ['Bearer ', filler.slice(0, 24)].join(''),
    'password = "hunter2hunter2hunter2"',
  ];
  for (const s of cases) {
    const { text, ledger } = redact(`the token is ${s}.`, {});
    assert.match(text, /<redacted:secret>/, `expected redaction for ${s}`);
    assert.ok(ledger.some((r) => r.rule === 'secret-token'), `ledger secret-token row for ${s}`);
  }
});

test('redact rule 6: a 40-hex git sha survives', () => {
  const sha = 'a'.repeat(40);
  const { text } = redact(`resolved sha ${sha}`, {});
  assert.match(text, new RegExp(sha));
});

test('redact rule 6: entropy heuristic matches on mixed-class blobs', () => {
  const blob = 'abcDEFghi012jkl345MNOpqr678STUvwx901';
  const { text, ledger } = redact(`blob ${blob} more`, {});
  // Either the entropy pattern OR a fallback pattern must have fired.
  const secretHits = ledger.filter((r) => r.rule === 'secret-token');
  if (secretHits.length > 0) {
    assert.match(text, /<redacted:secret>/);
  } else {
    // Entropy heuristic is intentionally conservative; a benign-looking
    // blob that misses is not a test failure, but this fixture is
    // engineered to hit.
    assert.fail(`expected entropy heuristic to fire on ${blob}`);
  }
});

test('redact rule 7: operator name and its long tokens become <operator>', () => {
  const { text, ledger } = redact('Alice Smith reviewed this. Smith wrote the code. Al is a nickname.', {
    operatorName: 'Alice Smith',
  });
  assert.match(text, /<operator>/);
  assert.match(text, /<operator> reviewed this\. <operator> wrote the code\. Al is a nickname\./);
  const row = ledger.find((r) => r.rule === 'operator-identity');
  assert.ok(row);
});

test('redact rule 7: project name and git remote redact', () => {
  const { text } = redact('Booking runs at git@github.com:wsd/booking.git', {
    projectName: 'Booking',
    gitRemote: 'git@github.com:wsd/booking.git',
  });
  assert.match(text, /<project>/);
  assert.match(text, /<project-remote>/);
});

test('redact rule 8a: em-dashes normalise to ASCII hyphens', () => {
  const { text, ledger } = redact('hello \u2014 world', {});
  assert.equal(text, 'hello - world');
  const row = ledger.find((r) => r.rule === 'size-shape');
  assert.ok(row);
});

test('redact rule 8a: oversize bodies truncate with a marker', () => {
  const big = 'x'.repeat(BODY_CAP_BYTES + 1024);
  const { text, ledger } = redact(big, {});
  assert.ok(Buffer.byteLength(text, 'utf8') <= BODY_CAP_BYTES);
  assert.match(text, /\[truncated by rcf feedback\]/);
  assert.ok(ledger.some((r) => r.rule === 'size-shape'));
});

test('redact rule 8b: a residual secret pattern is reported for refusal', () => {
  // Craft a string that survives the first pass by hiding inside a
  // token shape rule 6 does not match, then trigger a residual find.
  // The bearer pattern is caught in one pass, so use an explicit
  // findResidualSecrets check to prove the API works.
  const fake = ['ghp_', 'abcdefghijklmnopqrstuvwxyz1234567890'].join('');
  const hits = findResidualSecrets(`Line one\n${fake} second`);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 2);
});

test('redact preserves fingerprint stability: same input yields same output', () => {
  const input = 'hello /Users/jo/x/y jo@example.com';
  const context = { projectRoot: '/Users/jo/x' };
  const a = redact(input, context);
  const b = redact(input, context);
  assert.equal(a.text, b.text);
  assert.deepEqual(a.ledger, b.ledger);
});

test('allowedHosts merges the bundled set with the extension list', () => {
  const merged = allowedHosts(['wsd.example']);
  assert.ok(merged.includes('github.com'));
  assert.ok(merged.includes('wsd.example'));
});

// -- review fix round (2026-09-16 slice 1-3 review) ---------------------

test("F-slice-2-01: quoted and short kv-secret values are redacted (design 5 rule 5)", () => {
  const cases = [
    ['"password": "abc"', 'JSON with short quoted value'],
    ["password: 'x'", 'YAML with short single-quoted value'],
    ['token=abc', 'bare short unquoted value'],
    ['api_key = "1"', 'assignment with single-char quoted'],
    ['"client_secret":"ok"', 'no-space JSON short value'],
  ];
  for (const [input, label] of cases) {
    const { text } = redact(input, {});
    assert.match(text, /<redacted:secret>/, `expected redaction for ${label} (${input})`);
  }
});

test('F-slice-2-02: Authorization header value redaction removes the whole credential, not just the scheme', () => {
  const cred = 'YWRtaW46c3VwZXJzZWNyZXQxMjM';
  const { text } = redact(`Authorization: Basic ${cred}`, {});
  assert.doesNotMatch(text, new RegExp(cred), 'credential must be gone');
  assert.match(text, /<redacted:secret>/);
});

test('F-slice-2-03: PEM redaction covers the whole BEGIN..END block, not only the BEGIN delimiter', () => {
  const pem = [
    '-----BEGIN RSA PRIVATE KEY-----',
    'MIIEowIBAAKCAQEAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    'yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy',
    '-----END RSA PRIVATE KEY-----',
  ].join('\n');
  const { text } = redact(`prelude\n${pem}\npostlude`, {});
  assert.doesNotMatch(text, /MIIEow/);
  assert.doesNotMatch(text, /END RSA PRIVATE KEY/);
  assert.match(text, /<redacted:secret>/);
});

test('F-slice-2-04: residual pass catches authorization, kv-secret and entropy families after normalisation', () => {
  const kvHits = findResidualSecrets('password: "abcd"');
  assert.ok(kvHits.length >= 1, 'kv-secret must appear in residual patterns');
  const authHits = findResidualSecrets('Authorization: Basic zzzYYYxxxWWWvvvUUUtttSSSrrr');
  assert.ok(authHits.length >= 1, 'authorization must appear in residual patterns');
});

test('F-slice-2-05: IPv6 unique-local, link-local and generic addresses redact; ::1 loopback survives', () => {
  const { text } = redact('fc00::1 and fe80::1234 and 2001:db8::1 and ::1 loopback', {});
  assert.doesNotMatch(text, /fc00::1\b/);
  assert.doesNotMatch(text, /fe80::1234/);
  assert.doesNotMatch(text, /2001:db8/);
  assert.match(text, /::1 loopback/, 'IPv6 loopback survives');
});

test('F-slice-2-06: absolute paths with spaces AND the realpath project-root spelling both strip cleanly', () => {
  const { text: bareSpace } = redact('crashed at /Users/john doe/work/app.js line 12', {});
  assert.match(bareSpace, /<path>\/app\.js/, 'space-in-segment path folds to basename');
  assert.doesNotMatch(bareSpace, /doe/, 'username fragment must not bleed through');
  assert.doesNotMatch(bareSpace, /work\/app\.js/);

  const { text: rooted } = redact('opened /private/tmp/proj/src/x.js and /tmp/proj/src/x.js', {
    projectRoot: ['/tmp/proj', '/private/tmp/proj'],
  });
  assert.match(rooted, /<project>\/src\/x\.js/);
  assert.doesNotMatch(rooted, /\/private\/tmp\/proj/);
});

test('F-slice-2-07: git remote passed as an array of remotes (as `git remote -v` yields) all fold to <project-remote>', () => {
  const { text } = redact(
    'clone git@github.com:org/repo.git or use https://github.com/org/repo.git',
    { gitRemote: ['git@github.com:org/repo.git', 'https://github.com/org/repo.git'] },
  );
  assert.doesNotMatch(text, /org\/repo\.git/);
  const remoteCount = (text.match(/<project-remote>/g) ?? []).length;
  assert.ok(remoteCount >= 2, 'each remote spelling is redacted');
});

test('F-slice-2-09: ledger keeps every distinct secret sample so the operator sees exactly what was stripped', () => {
  const filler = 'abcdefghijklmnopqrstuvwxyz1234567890';
  const t1 = ['ghp_', filler].join('');
  const t2 = ['sk_', 'live_', filler.slice(0, 20)].join('');
  const { ledger } = redact(`${t1} and ${t2}`, {});
  const rows = ledger.filter((r) => r.rule === 'secret-token');
  // Each distinct sample stays as its own row - not folded into one
  // concatenated line - so a maintainer reading preview sees the list.
  assert.ok(rows.length >= 2, `expected at least 2 secret-token rows, got ${rows.length}`);
});

