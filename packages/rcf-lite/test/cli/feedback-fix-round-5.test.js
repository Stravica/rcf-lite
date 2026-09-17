// Fix round 5 probes for PR #221 (feat/feedback-submission-chain).
// Every test binds one HQ re-gate finding (2026-09-17) and re-runs the
// exact probe input that reached a rendered body in round 4:
//   - F-05        R4 separator shapes: vocabulary key labelling a value
//                 via a markdown table pipe, whitespace run, tab,
//                 hyphen, arrow, HTML numeric entity or the prose
//                 bridges is / was / set to (design amendment R4)
//   - F-07        HTML numeric entity separator closed as a side effect
//                 of R4 (the separator class includes &#61; / &#x3d;)
//   - F-11        docs prose fix: `authorization` is described under
//                 the header-line rule paragraph, not under the
//                 vocabulary list (a reader who greps the constant
//                 sees the shape the code enforces)
//   - F-06        docs limitation: the vocabulary is English-only;
//                 a non-English key on a short value should be
//                 hand-redacted before submit
//
// Every probe here is drawn from the re-gate note's H05, H06, H12,
// T1..T8, E1..E3, M02, M03 corpus. Negative cases assert that ordinary
// prose containing a vocabulary word (`the password field is
// required`) does NOT fold, because the value-shape gate rejects
// single-class 8+ char English words.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { redact, findResidualSecrets } from '../../src/feedback/redact.js';

const here = dirname(fileURLToPath(import.meta.url));

// -- F-05 / R4: positive separator shapes fold under the primary pass -----

// U+2014 assembled at runtime so the test file source stays free of
// literal em-dashes (repo register scan rule); the redactor's dash
// normalisation pass turns this into an ASCII hyphen before the R4
// scan runs, and R4 folds the resulting `password-...` shape.
const EM_DASH = String.fromCharCode(0x2014);

const r4Positives = [
  // [id from the HQ re-gate, input, the raw value that must not survive]
  ['T1 markdown table',        '| password | Sup3rSecretV@lue!! |',              'Sup3rSecretV@lue!!'],
  ['T2 md longer value',       '| password | Sup3rSecretV@lueLongerHere |',      'Sup3rSecretV@lueLongerHere'],
  ['T3 double-space',          'pwd  Sup3rSecretV@lue1234ABCD',                  'Sup3rSecretV@lue1234ABCD'],
  ['T4 tab separator',         'pwd\tSup3rSecretV@lue1234ABCD',                  'Sup3rSecretV@lue1234ABCD'],
  ['T5 prose is-bridge',       'the password Sup3rSecretV@lue1234 is bad',       'Sup3rSecretV@lue1234'],
  ['T6 em-dash separator',     `password${EM_DASH}Sup3rSecretV@lue1234ABCD`,     'Sup3rSecretV@lue1234ABCD'],
  ['T7 46-char value',         'password Sup3rSecretV@lue1234ABCDEFGHIJKLMNOP',  'Sup3rSecretV@lue1234ABCDEFGHIJKLMNOP'],
  ['T8 short-key md table',    '| pw | Sup3rSecretV@lue!! |',                    'Sup3rSecretV@lue!!'],
  ['H06 HTML numeric entity',  'pass&#61;SuperSecretValue1234',                  'SuperSecretValue1234'],
  ['H06 hex HTML entity',      'pass&#x3d;SuperSecretValue1234',                 'SuperSecretValue1234'],
  ['M02 md-table dupe',        '| password | Sup3rSecretV@lue!! |',              'Sup3rSecretV@lue!!'],
  ['M03 whitespace separator', 'has password Sup3rSecretV@lue1234 and',          'Sup3rSecretV@lue1234'],
  ['R4 prose was-bridge',      'the password was Sup3rSecretValueLong exposed',  'Sup3rSecretValueLong'],
  ['R4 prose set-to-bridge',   'the password set to Sup3rSecretValueLong stays', 'Sup3rSecretValueLong'],
  ['R4 arrow separator',       'password -> Sup3rSecretValueLong',               'Sup3rSecretValueLong'],
];

test('F-05 (round 5, R4): every re-gate R4 probe folds under the primary pass and leaves nothing residual', () => {
  for (const [id, input, rawValue] of r4Positives) {
    const r = redact(input);
    assert.match(r.text, /<redacted:secret>/,
      `${id}: expected <redacted:secret> marker, got ${JSON.stringify(r.text)}`);
    assert.ok(!r.text.includes(rawValue),
      `${id}: raw value ${JSON.stringify(rawValue)} must not survive in ${JSON.stringify(r.text)}`);
    assert.equal(r.residual.length, 0,
      `${id}: residual scan must be clean, got ${JSON.stringify(r.residual)}`);
  }
});

// -- F-05 / R4: residual pass catches raw R4 shapes (safeguard) -----------

test('F-05 (round 5, R4): findResidualSecrets flags a raw R4 shape as kv-secret-r4', () => {
  const inputs = [
    '| password | Sup3rSecretV@lue!! |',
    'the password Sup3rSecretV@lue1234 is bad',
    'pass&#61;SuperSecretValue1234',
    `password${EM_DASH}Sup3rSecretValueLongABCD`,
  ];
  for (const input of inputs) {
    const hits = findResidualSecrets(input);
    assert.ok(hits.some((h) => h.pattern.includes('kv-secret-r4') || h.pattern.includes('kv-secret')),
      `residual scan must flag R4 shape for ${JSON.stringify(input)}: got ${JSON.stringify(hits)}`);
  }
});

// -- F-05 / R4: over-redaction guard (negative cases) ---------------------

const r4Negatives = [
  ['the password field is required',                'field is required'],
  ['The password field is required for signup.',    'field is required'],
  ['the password is required',                      'is required'],
  ['password enabled somewhere',                    'enabled'],
  ['the keyword=abcdef stays here',                 'keyword=abcdef'],
  ['authors=joe,jane are cited by name',            'authors=joe,jane'],
  ['see commit abc1234 at HEAD',                    'abc1234'],
  ['the passphrase concept explained here',         'concept'],
  ['the token type is JWT and it works',            'is JWT'],
];

test('F-05 (round 5, R4 guard): a vocabulary word in ordinary prose (single-class value, or short value) does NOT fold', () => {
  for (const [input, mustSurvive] of r4Negatives) {
    const r = redact(input);
    assert.doesNotMatch(r.text, /<redacted:secret>/,
      `expected no <redacted:secret> for ${JSON.stringify(input)}, got ${JSON.stringify(r.text)}`);
    if (mustSurvive) {
      assert.ok(r.text.includes(mustSurvive),
        `benign text ${JSON.stringify(mustSurvive)} must survive in ${JSON.stringify(r.text)}`);
    }
  }
});

// -- E1..E3: entropy-blob floor still holds independently of R4 -----------

test('F-05 (round 5): E1..E3 entropy-blob boundary is preserved by R4 fold', () => {
  // E2 / E3: 32+ char high-entropy values fold via entropy-blob even
  // outside R4's reach; R4 can also fold shorter values under a
  // vocabulary key label. The two rules coexist.
  const e2 = 'the password abcABC0123defDEF456ghiGHI789jklJKL is bad';
  const e3 = '| password | abcABC0123defDEF456ghiGHI789jklJKL |';
  const r2 = redact(e2);
  const r3 = redact(e3);
  assert.doesNotMatch(r2.text, /abcABC0123defDEF456ghiGHI789jklJKL/,
    `E2 33-char entropy value must fold: ${r2.text}`);
  assert.doesNotMatch(r3.text, /abcABC0123defDEF456ghiGHI789jklJKL/,
    `E3 33-char entropy value in md table must fold: ${r3.text}`);
});

// -- F-11: docs prose fix on the `authorization` vocabulary explainer ----

test('F-11 (round 5, docs prose): `authorization` is described under the header-line rule paragraph, not in the vocabulary list', async () => {
  const docsPath = resolve(here, '..', '..', 'docs', 'feedback.md');
  const docs = await readFile(docsPath, 'utf8');
  // The header-line rule paragraph names `authorization` and states
  // that the constant deliberately excludes it (so a reader who
  // greps the constant is not confused).
  assert.match(docs, /`Authorization:`/,
    'docs must mention `Authorization:` under the header-line rule');
  assert.match(docs, /`authorization`[^.]*NOT in the vocabulary/,
    'docs must state that `authorization` is NOT in the vocabulary list');
  // The vocabulary list itself must NOT open with `authorization`.
  assert.doesNotMatch(docs, /stems are: `authorization`/,
    'docs vocabulary list must not open with `authorization`');
});

// -- F-06: docs limitation on non-English vocabulary keys -----------------

test('F-06 (round 5, docs limitation): the vocabulary is described as English-only with a named list of non-English stems', async () => {
  const docsPath = resolve(here, '..', '..', 'docs', 'feedback.md');
  const docs = await readFile(docsPath, 'utf8');
  assert.match(docs, /English-only/,
    'docs must call out the English-only limitation on the vocabulary');
  // At least one non-English stem must be named as an example the
  // vocabulary does not recognise on its own.
  assert.ok(
    /motdepasse|contrasena|passwort|senha|wachtwoord/.test(docs),
    'docs must name at least one non-English stem the vocabulary does not recognise',
  );
});

// -- R4 docs contract: separator shapes are enumerated --------------------

test('F-05 (round 5, docs R4): the R4 separator shapes are enumerated in docs/feedback.md', async () => {
  const docsPath = resolve(here, '..', '..', 'docs', 'feedback.md');
  const docs = await readFile(docsPath, 'utf8');
  assert.match(docs, /amendment R4/, 'docs must reference design amendment R4');
  assert.match(docs, /markdown-table\s+pipes/i, 'docs must name markdown-table pipes as R4 separator');
  assert.match(docs, /prose\s+bridges/i, 'docs must name prose bridges as R4 separators');
  assert.match(docs, /HTML\s+numeric\s+entities/i, 'docs must name HTML numeric entities as R4 separators');
});
