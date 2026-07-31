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
