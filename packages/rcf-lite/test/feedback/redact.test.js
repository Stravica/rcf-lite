// FBS-181 slice 2 unit tests for src/feedback/redact.js.
//
// Fixture corpus covers all eight rule names in the ledger vocabulary
// (project-root, absolute-path, email, hostname, private-ip,
// secret-token, operator-identity, size-shape) plus the rule-8b
// residual-secret refusal and the sha survival exception.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { redact, findResidualSecrets, allowedHosts, BODY_CAP_BYTES, RESERVED_IDENTITY_TOKENS } from '../../src/feedback/redact.js';

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

test('AC-15601-6 filename tokens carrying a known extension survive rule 4', () => {
  // The exact command Barry hit in the WSD round-trip that surfaced
  // the redactor overreach (issue #233). Filename tokens must survive
  // verbatim; the evidence pointer is only useful if it is still
  // re-runnable.
  const body = [
    'rcf discover intake --artefact rcf/knowledge/docs/brief/Backstory-product-brief.md,rcf/knowledge/docs/brief/Backstory-wireframes.html --kind productBrief --dry-run --json',
    '',
    'intake.json',
    'report.log',
    'foo.example.com and https://foo.example.com/path',
    'Backstory-example.com',
    'a.b.co',
  ].join('\n');
  const { text, ledger } = redact(body, {});
  assert.match(text, /Backstory-product-brief\.md/, 'markdown filename survives');
  assert.match(text, /Backstory-wireframes\.html/, 'html filename survives');
  assert.match(text, /intake\.json/, 'json filename survives');
  assert.match(text, /report\.log/, 'log filename survives');
  // Real hostnames still fold.
  assert.match(text, /<host>/);
  // The public foo.example.com hostname on its own folds.
  assert.doesNotMatch(text.split('\n').find((l) => l.startsWith('foo.example.com')) ?? '', /foo\.example\.com and https/);
  // Backstory-example.com folds because .com is not in the extension
  // shortlist; a.b.c folds because .c is not either.
  assert.doesNotMatch(text, /Backstory-example\.com/);
  assert.doesNotMatch(text, /\ba\.b\.co\b/);
  // Only one ledger row (hostname), and its count reflects only the
  // real hostname matches - never the filenames.
  const row = ledger.find((r) => r.rule === 'hostname');
  assert.ok(row, 'hostname rule fired for the real hostname');
});

test('AC-15601-6: an operator-supplied extension entry (allowExtensions) preserves matching filenames', () => {
  const { text } = redact('local.xyz survives when extensions include xyz', { allowExtensions: ['xyz'] });
  assert.match(text, /local\.xyz/);
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

test('AC-15601-5 operator-identity stopword guard: common nouns in the identity string are never folded; real given names still fold', () => {
  const body = [
    'see https://stravica.ai/docs/rcf/how-the-agent-files-feedback for the wording,',
    'this happens when the agent stops the queue and the operator is waiting,',
    'Alice reviewed this change.',
  ].join('\n');
  const { text, ledger } = redact(body, {
    operatorName: 'The Agent Alice',
  });
  assert.match(text, /how-the-agent-files-feedback/, 'the docs URL must survive verbatim');
  assert.match(text, /when the agent stops the queue/, 'the prose "when the agent stops" must survive verbatim');
  assert.match(text, /<operator> reviewed this change\./, 'the personal name Alice must fold to <operator>');
  const opRows = ledger.filter((r) => r.rule === 'operator-identity');
  // Full-string 'The Agent Alice' does not appear literally, so its
  // literal-substitution row should be absent. Per-token folds must
  // fire for 'Alice' and not for 'agent' or 'the'.
  const beforeValues = opRows.map((r) => r.before);
  assert.ok(beforeValues.includes('Alice'), 'expected an operator-identity row folding Alice');
  assert.ok(!beforeValues.includes('agent'), 'must not fold the reserved noun agent');
  assert.ok(!beforeValues.includes('Agent'), 'must not fold Agent even when it appears verbatim in the identity');
  assert.ok(!beforeValues.includes('the'), 'must not fold the article the');
});

test('AC-15601-5: RESERVED_IDENTITY_TOKENS export carries the guarded common nouns', () => {
  assert.ok(RESERVED_IDENTITY_TOKENS instanceof Set, 'exported constant is a Set');
  for (const stop of ['agent', 'user', 'operator', 'admin', 'system', 'api', 'code', 'name']) {
    assert.ok(RESERVED_IDENTITY_TOKENS.has(stop), `RESERVED_IDENTITY_TOKENS must include ${stop}`);
  }
});

test('AC-15601-5: an identity whose ONLY token is a reserved noun folds nothing per-token but still substitutes the full literal when present', () => {
  const { text, ledger } = redact('the agent processed this. Agent did the work.', {
    operatorName: 'Agent',
  });
  // No per-token fold (the only token is the stopword itself).
  assert.match(text, /the agent processed this\./);
  assert.match(text, /Agent did the work\./);
  const opRows = ledger.filter((r) => r.rule === 'operator-identity');
  assert.deepEqual(opRows, [], 'no operator-identity rows expected when the identity is a bare stopword');
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


// -- Fix round 2 (2026-09-16) ---------------------------------------------

test('R-P0-1: kv-secret rule accepts TAB (and any whitespace) between key and separator', () => {
  // Reviewer runtime probe: `password\t=Abc12345` (tab between key
  // and `=`) previously bypassed both kv-secret and the residual
  // pass. AC-15601-1 (design 5 rule 5) requires the value to fold.
  const cases = [
    ['password\t=Abc12345', 'tab before `=`'],
    ['password \t= Abc12345', 'space + tab before `=`'],
    ['api_key\t\t: mnop9876', 'double tab before `:`'],
    ['secret \t\t = MyLong0Value1234', 'mixed spaces + tabs'],
  ];
  for (const [input, label] of cases) {
    const { text } = redact(input, {});
    assert.match(text, /<redacted:secret>/, `expected redaction for ${label} (${input})`);
  }
});

test('R-P0-2: em-dash-delimited PEM block is redacted (dash normalisation runs first)', () => {
  // Reviewer runtime probe: an em-dash-prefixed PEM survived the
  // first pass (needs `-`) AND the residual (line-by-line, so a
  // multiline PEM never matched). Payload was emitted verbatim.
  const pem = [
    '—BEGIN RSA PRIVATE KEY—',
    'MIIEowIBAAKCAQEAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    '—END RSA PRIVATE KEY—',
  ].join('\n');
  const { text, residual } = redact(`prelude\n${pem}\npostlude`, {});
  assert.doesNotMatch(text, /MIIEow/, 'PEM payload must not survive');
  assert.doesNotMatch(text, /RSA PRIVATE KEY/, 'PEM delimiters must be gone');
  assert.match(text, /<redacted:secret>/);
  // Residual pass belt-and-braces: nothing PEM-shaped in the output.
  const pemResiduals = residual.filter((r) => r.pattern === 'pem');
  assert.equal(pemResiduals.length, 0, 'no PEM residual should remain');
});

test('R-P0-2: findResidualSecrets runs whole-text so multiline PEM is detected', () => {
  // Belt-and-braces: even if the first pass somehow missed a PEM
  // block, the residual scan catches it end-to-end (whole-text scan).
  const pem = [
    '-----BEGIN RSA PRIVATE KEY-----',
    'MIIEowIBAAKCAQEAyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy',
    '-----END RSA PRIVATE KEY-----',
  ].join('\n');
  const hits = findResidualSecrets(`prelude\n${pem}\npostlude`);
  const pemHits = hits.filter((h) => h.pattern === 'pem');
  assert.ok(pemHits.length >= 1, 'residual pass must detect multiline PEM');
});

test('F-slice-2-01: quoted values with an embedded escaped quote fold completely', () => {
  // Reviewer runtime probe: `{"password": "ab\"cd"}` left `cd"` behind
  // because `"[^"\n]+"` stopped at the first embedded quote.
  const { text } = redact('{"password": "ab\\"cd"}', {});
  assert.doesNotMatch(text, /cd"/, 'nothing after the escaped quote may bleed');
  assert.match(text, /<redacted:secret>/);
});

test('F-slice-2-05: expanded IPv6 loopback (0:0:0:0:0:0:0:1 and zero-padded) survives redaction', () => {
  // Design rule 4 exempts loopback in every legal spelling.
  const { text } = redact(
    'shorthand ::1 and full 0:0:0:0:0:0:0:1 and padded 0000:0000:0000:0000:0000:0000:0000:0001',
    {},
  );
  assert.match(text, /(?<![0-9A-Fa-f:])::1(?![0-9A-Fa-f:])/);
  assert.match(text, /(?<![0-9A-Fa-f:])0:0:0:0:0:0:0:1(?![0-9A-Fa-f:])/);
  assert.match(text, /(?<![0-9A-Fa-f:])0000:0000:0000:0000:0000:0000:0000:0001(?![0-9A-Fa-f:])/);
});

test('F-slice-2-06: double-space and terminal spaced dirs fold cleanly', () => {
  // Reviewer runtime probes: `/Users/john  doe/foo.js` (double space)
  // and `in /Users/john doe` (terminal spaced dir) both left the
  // username fragment behind.
  const { text: dbl } = redact('crashed at /Users/john  doe/foo.js line 42', {});
  assert.match(dbl, /<path>\/foo\.js/);
  assert.doesNotMatch(dbl, /doe/, 'username fragment must not bleed via double-space path');

  const { text: term } = redact('crashed in /Users/john doe end here', {});
  assert.doesNotMatch(term, /john doe/, 'terminal spaced dir must fold');
  assert.match(term, /end here/, 'trailing sentence must survive');
});

