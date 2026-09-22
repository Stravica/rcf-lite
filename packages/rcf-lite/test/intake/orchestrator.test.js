// Track C+D §6 orchestrator tests. Runs the intake orchestrator against
// a tmpdir project with a real artefact file and asserts the composed
// record shape.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runIntakePhases } from '../../src/intake/orchestrator.js';

test('runIntakePhases classifies a briefStrong artefact and surfaces findings', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rcf-intake-'));
  const brief = [
    Array(200).fill('word').join(' '),
    '## Capabilities',
    '- monitor uptime',
    '## Non-functional constraints',
    '- runs on Raspberry Pi',
    '## Out-of-scope',
    '- multi-tenant',
    'Recovery emails via Resend when an outage clears.',
    'The admin dashboard exposes every monitor.',
  ].join('\n');
  const artefactPath = join(dir, 'brief.md');
  await writeFile(artefactPath, brief, 'utf8');

  const outcome = await runIntakePhases({
    projectRoot: dir,
    artefactPaths: [artefactPath],
    kindHint: 'productBrief',
    now: new Date('2026-07-31T12:00:00.000Z'),
  });
  assert.ok(!outcome.kind, `unexpected error: ${JSON.stringify(outcome)}`);
  assert.equal(outcome.record.fidelity, 'briefStrong');
  assert.equal(outcome.record.artefacts.length, 1);
  assert.equal(outcome.record.artefacts[0].kind, 'productBrief');
  assert.match(outcome.record.artefacts[0].hash, /^sha256:/);
  const kinds = outcome.record.validationFindings.map((f) => f.kind);
  assert.ok(kinds.includes('missingLoadBearingConstraint'), `expected Resend-env finding, got ${JSON.stringify(kinds)}`);
  assert.equal(outcome.record.operatorAckAt, '2026-07-31T12:00:00.000Z');
});

test('runIntakePhases returns an RcfError on a missing artefact file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rcf-intake-'));
  const outcome = await runIntakePhases({
    projectRoot: dir,
    artefactPaths: ['does-not-exist.md'],
  });
  assert.equal(outcome.kind, 'usage');
  assert.match(outcome.message, /cannot read artefact/);
});

// 0.28.2 (issue #229): findings are material-scoped, deduped by
// (kind, detail) before timestamping. Two artefacts that both trip
// the same branch land as ONE finding.
test('runIntakePhases dedupes an impliedButNotStated finding that fires on two artefacts (0.28.2 #229)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rcf-intake-dedupe-'));
  const webUiBody = [
    'The admin dashboard exposes every monitor.',
    'Users log in via a browser.',
    Array(50).fill('word').join(' '),
  ].join('\n');
  const briefA = join(dir, 'brief-a.md');
  const briefB = join(dir, 'brief-b.md');
  await writeFile(briefA, webUiBody, 'utf8');
  await writeFile(briefB, webUiBody, 'utf8');
  const outcome = await runIntakePhases({
    projectRoot: dir,
    artefactPaths: [briefA, briefB],
    kindHint: 'productBrief',
  });
  assert.ok(!outcome.kind, `unexpected error: ${JSON.stringify(outcome)}`);
  const implied = outcome.record.validationFindings.filter((f) => f.kind === 'impliedButNotStated');
  assert.equal(implied.length, 1, `expected one impliedButNotStated finding across two artefacts, got ${implied.length}`);
});

test('runIntakePhases folds operator-supplied validationFindings of ANY kind (not just otherDeclared) from --input (0.28.2 #229)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rcf-intake-input-findings-'));
  const artefactBody = 'A short brief with no red-flags.';
  const artefact = join(dir, 'brief.md');
  await writeFile(artefact, artefactBody, 'utf8');
  const outcome = await runIntakePhases({
    projectRoot: dir,
    artefactPaths: [artefact],
    kindHint: 'productBrief',
    input: {
      fidelity: 'briefLight',
      validationFindings: [
        { kind: 'contradiction', detail: 'PRD says X but PRD also says not-X' },
        { kind: 'impliedButNotStated', detail: 'a web UI is implied but no sign-in surface named' },
        { kind: 'otherDeclared', detail: 'operator declared a residual doubt' },
      ],
    },
  });
  assert.ok(!outcome.kind, `unexpected error: ${JSON.stringify(outcome)}`);
  const kinds = outcome.record.validationFindings.map((f) => f.kind).sort();
  assert.ok(kinds.includes('contradiction'), `contradiction must survive --input, got ${JSON.stringify(kinds)}`);
  assert.ok(kinds.includes('impliedButNotStated'), `impliedButNotStated must survive --input, got ${JSON.stringify(kinds)}`);
  assert.ok(kinds.includes('otherDeclared'), `otherDeclared must survive --input, got ${JSON.stringify(kinds)}`);
});

test('runIntakePhases coalesces an operator-authored finding with a scan-authored duplicate; the operator response survives (0.28.2 #229)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rcf-intake-coalesce-'));
  const webUiBody = [
    'The admin dashboard exposes every monitor.',
    'Users log in via a browser.',
    Array(50).fill('word').join(' '),
  ].join('\n');
  const artefact = join(dir, 'brief.md');
  await writeFile(artefact, webUiBody, 'utf8');
  // Look up the exact detail the scanner emits so we can echo it.
  const outcomeProbe = await runIntakePhases({
    projectRoot: dir,
    artefactPaths: [artefact],
    kindHint: 'productBrief',
  });
  const implied = outcomeProbe.record.validationFindings.find((f) => f.kind === 'impliedButNotStated');
  assert.ok(implied, 'probe expected an impliedButNotStated finding');
  const scanDetail = implied.detail;
  const outcome = await runIntakePhases({
    projectRoot: dir,
    artefactPaths: [artefact],
    kindHint: 'productBrief',
    input: {
      validationFindings: [
        { kind: 'impliedButNotStated', detail: scanDetail, operatorResponse: 'sign-in via magic link; TAC-2214 covers it' },
      ],
    },
  });
  const matches = outcome.record.validationFindings.filter((f) => f.kind === 'impliedButNotStated');
  assert.equal(matches.length, 1, 'the scan hit and the operator finding coalesce into one');
  assert.equal(matches[0].operatorResponse, 'sign-in via magic link; TAC-2214 covers it');
});
