// FBS-181 slice 2 unit tests for src/feedback/render.js.
//
// Golden shape assertions for the title, body, +1 comment and outbox
// bundle. The fingerprint appears twice (visible line and HTML
// comment) in every rendered body per design section 6.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderIssue, renderComment, renderBundle, LABEL_CATALOGUE } from '../../src/feedback/render.js';

const blueprintEntry = {
  id: 'fb-20260916-a3f1',
  kind: 'blueprint',
  target: {
    ref: 'wsd:std-error-envelope',
    effectiveSlug: 'wsd-std-error-envelope',
    blueprintVersion: '1.2.0',
    libraryPrefix: 'wsd',
    libraryRef: '1.4.0',
    resolvedSha: '9c2eabcdef1234567890abcdef1234567890abcd',
  },
  anchor: 'TAC-5002-wsd-std-error-envelope',
  symptomClass: 'docs-mismatch',
  severity: 'minor',
  environment: {
    harness: 'codex',
    rcfLiteVersion: '0.28.0',
    nodeVersion: '24.14.0',
    platform: 'darwin',
  },
};

const coreEntry = {
  id: 'fb-20260916-c07e',
  kind: 'core',
  target: { ref: 'define validate' },
  anchor: 'REQ-155',
  symptomClass: 'validate-fails',
  severity: 'blocker',
  environment: {
    harness: 'claude-code',
    rcfLiteVersion: '0.28.0',
    nodeVersion: '24.14.0',
    platform: 'linux',
  },
};

const redacted = {
  title: 'probe calls requestId() but the TAC documents a getter',
  body: 'Body of the report goes here.',
  evidence: [
    { kind: 'command', value: 'node rcf/blueprints/wsd-std-error-envelope/probe.mjs' },
    { kind: 'file', value: 'rcf/blueprints/wsd-std-error-envelope/probe.mjs:41' },
  ],
  ledger: [
    { rule: 'project-root', before: '/Users/jo/proj', after: '<project>', count: 1 },
    { rule: 'email', before: 'jo@example.com', after: '<email>', count: 2 },
  ],
};

test('renderIssue prefixes the title with the blueprint slug', () => {
  const meta = { fingerprint: '7f3a9c1e2b44', destination: { repo: 'wsd/x', visibility: 'private' } };
  const { title } = renderIssue(blueprintEntry, redacted, meta);
  assert.equal(title, '[wsd-std-error-envelope] probe calls requestId() but the TAC documents a getter');
});

test('renderIssue prefixes core titles with [rcf-lite]', () => {
  const meta = { fingerprint: '111111111111', destination: { repo: 'Stravica/rcf-lite', visibility: 'public' } };
  const { title } = renderIssue(coreEntry, { ...redacted, evidence: [] }, meta);
  assert.equal(title, '[rcf-lite] probe calls requestId() but the TAC documents a getter');
});

test('renderIssue body carries the fingerprint twice and the Environment table', () => {
  const meta = { fingerprint: '7f3a9c1e2b44', destination: { repo: 'wsd/x', visibility: 'private' } };
  const { body } = renderIssue(blueprintEntry, redacted, meta);
  // Visible line.
  assert.match(body, /^rcf-feedback-fingerprint: 7f3a9c1e2b44$/m);
  // HTML-comment twin.
  assert.match(body, /<!-- rcf-feedback-fingerprint: 7f3a9c1e2b44 -->/);
  assert.match(body, /\*\*Environment\*\*/);
  assert.match(body, /\| harness \| codex \|/);
  assert.match(body, /Redaction ledger: 1 project-root, 2 email\./);
});

test('renderIssue body evidence rows include kind labels', () => {
  const meta = { fingerprint: 'aaaaaaaaaaaa', destination: { repo: 'x/y', visibility: 'public' } };
  const { body } = renderIssue(blueprintEntry, redacted, meta);
  assert.match(body, /- `node rcf\/blueprints\/wsd-std-error-envelope\/probe\.mjs` \(command\)/);
  assert.match(body, /- `rcf\/blueprints\/wsd-std-error-envelope\/probe\.mjs:41` \(file\)/);
});

test('renderIssue labels default to the six-label bootstrap subset', () => {
  const meta = { fingerprint: 'bbbbbbbbbbbb', destination: { repo: 'x/y', visibility: 'private' } };
  const { labels } = renderIssue(blueprintEntry, redacted, meta);
  assert.deepEqual(labels, ['rcf-feedback', 'severity:minor', 'area:blueprint']);
  for (const l of labels) assert.ok(LABEL_CATALOGUE.includes(l), `label ${l} in catalogue`);
});

// 0.28.2 (issue #234): the retired "+1 from another reporter." payload
// is gone; every fold comment carries the full report so a human can
// judge whether the match is real.
test('renderComment carries the Apparent-duplicate preamble, the full report, and the fingerprint (0.28.2)', () => {
  const meta = { fingerprint: 'cccccccccccc' };
  const { body } = renderComment(blueprintEntry, redacted, meta);
  assert.match(body, /^Apparent duplicate of the issue subject; posting the full report so a human can judge\./);
  assert.doesNotMatch(body, /\+1 from another reporter\./);
  assert.match(body, /## Report:/);
  assert.match(body, /\| harness \| codex \|/);
  assert.match(body, /rcf-feedback-fingerprint: cccccccccccc$/m);
});

test('renderComment includes the redacted body, evidence rows and title (0.28.2)', () => {
  const meta = { fingerprint: 'dddddddddddd' };
  const { body } = renderComment(blueprintEntry, redacted, meta);
  // The full report shape: body -> evidence -> environment table -> fingerprint.
  assert.match(body, redacted.body.length > 0 ? new RegExp(redacted.body.split('\n')[0].slice(0, 20)) : /## Report:/);
  assert.match(body, /\*\*Evidence\*\*/);
  assert.match(body, /rcf-feedback-fingerprint: dddddddddddd$/m);
});

test('renderBundle emits a header block and one section per entry', () => {
  const dest = { repo: 'wsd/x', visibility: 'private', reasonNotFiled: 'viewerPermission NONE', libraryContact: 'ops@wsd.example' };
  const rows = [
    { entry: blueprintEntry, redacted, fingerprint: 'e1e1e1e1e1e1' },
    { entry: coreEntry, redacted: { ...redacted, evidence: [] }, fingerprint: 'e2e2e2e2e2e2' },
  ];
  const out = renderBundle(dest, rows, { generatedAt: '2026-09-16T15:40:03Z', rcfLiteVersion: '0.28.0' });
  assert.match(out, /^# rcf-lite feedback bundle\n/);
  assert.match(out, /Destination: https:\/\/github\.com\/wsd\/x\/issues\/new/);
  assert.match(out, /Reason not filed: viewerPermission NONE/);
  assert.match(out, /Library contact: ops@wsd\.example/);
  assert.match(out, /Entries: 2/);
  assert.match(out, /Generated: 2026-09-16T15:40:03Z by rcf-lite 0\.28\.0/);
  // Two `## ` sections, one per entry.
  const sections = out.match(/\n## /g) ?? [];
  assert.equal(sections.length, 2);
  // Each section carries the fingerprint twin.
  assert.match(out, /rcf-feedback-fingerprint: e1e1e1e1e1e1/);
  assert.match(out, /rcf-feedback-fingerprint: e2e2e2e2e2e2/);
});

test('LABEL_CATALOGUE is the six-label bootstrap and is stable', () => {
  assert.deepEqual([...LABEL_CATALOGUE], [
    'rcf-feedback',
    'severity:blocker',
    'severity:major',
    'severity:minor',
    'area:blueprint',
    'area:core',
  ]);
});

// -- review fix round (2026-09-16 slice 1-3 review) ---------------------

import { BODY_CAP_BYTES } from '../../src/feedback/redact.js';

test('F-slice-2-10: rendered body is capped at BODY_CAP_BYTES (design 5 rule 7)', () => {
  // Fill the free-form body right up to the cap; the evidence,
  // environment table, fingerprint twin and consent tail will push
  // the rendered body over unless capRenderedBody trims the head.
  const big = 'x'.repeat(BODY_CAP_BYTES);
  const entry = {
    kind: 'blueprint',
    target: { ref: 'wsd:x', effectiveSlug: 'wsd-x', libraryPrefix: 'wsd' },
    anchor: 'AC-1-1',
    symptomClass: 'docs-mismatch',
    severity: 'minor',
    environment: { harness: 'codex', rcfLiteVersion: '0.28.0', nodeVersion: '24.14.0', platform: 'darwin' },
  };
  const redacted = { title: 't', body: big, evidence: [{ kind: 'command', value: 'x' }], ledger: [] };
  const meta = { fingerprint: 'abcdef012345', destination: { repo: null, visibility: 'unresolved' } };
  const rendered = renderIssue(entry, redacted, meta);
  assert.ok(
    Buffer.byteLength(rendered.body, 'utf8') <= BODY_CAP_BYTES,
    `rendered body must be under BODY_CAP_BYTES (${BODY_CAP_BYTES}) after cap`,
  );
  // The fingerprint tail must survive so dedupe still works.
  assert.match(rendered.body, /rcf-feedback-fingerprint: abcdef012345/);
});

test('F-slice-2-12: bundle rendering preserves 3+ consecutive newlines inside embedded bodies', () => {
  const bodyWithGap = 'first line\n\n\nsecond line after three newlines';
  const entry = {
    kind: 'core',
    target: { ref: 'define validate' },
    anchor: 'AC-1',
    symptomClass: 'wrong-output',
    severity: 'minor',
    environment: { harness: 'other', rcfLiteVersion: '0.28.0', nodeVersion: '24.14.0', platform: 'darwin' },
  };
  const rendered = renderBundle(
    { repo: 'Stravica/rcf-lite', visibility: 'public' },
    [{ entry, redacted: { title: 't', body: bodyWithGap, evidence: [], ledger: [] }, fingerprint: 'f1' }],
    { generatedAt: '2026-09-16T00:00:00Z', rcfLiteVersion: '0.28.0' },
  );
  assert.match(rendered, /first line\n\n\nsecond line/, 'bundle body preserves the 3+ newline run intact');
});
