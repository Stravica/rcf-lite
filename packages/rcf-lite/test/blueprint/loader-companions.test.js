// Unit tests for the companion-suggestion loader additions
// (core-companions spec 2.1 + amendment A2).
//
// Covers TS-040: loader accepts providesRoles[] and suggestedCompanions[]
// with shape validation, em-dash and emoji refusal on the reason string,
// and the paired-scope:global-ADR gate.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadBlueprint } from '../../src/blueprint/loader.js';

async function writeBlueprint(meta, adrBodies = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'rcf-loader-companions-'));
  await mkdir(join(dir, 'contributions', 'adrs'), { recursive: true });
  await writeFile(join(dir, 'blueprint.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  for (const [rel, body] of Object.entries(adrBodies)) {
    const abs = join(dir, 'contributions', rel);
    await mkdir(join(abs, '..'), { recursive: true });
    await writeFile(abs, body, 'utf8');
  }
  return dir;
}

test('loader accepts and preserves providesRoles and suggestedCompanions (AC-1401-1)', async () => {
  const dir = await writeBlueprint({
    slug: 'scratch-provider', version: '1.0.0', category: 'observability',
    providesRoles: ['logging'],
    suggestedCompanions: [{ role: 'logging', reason: 'A one-sentence reason describing the companion.' }],
    contributions: [
      { id: 'ADR-9001-scratch-provider-shape', kind: 'adr', path: 'adrs/adr-9001.json', scope: 'global', topic: 'logging' },
    ],
  }, { 'adrs/adr-9001.json': JSON.stringify({ adrId: 'ADR-9001-scratch-provider-shape', prdId: 'PRD-001', tadId: 'TAD-001', version: '1.0.0', status: 'accepted', title: 'x', context: 'x', decision: 'x', consequences: 'x' }) });
  const r = await loadBlueprint(dir);
  assert.equal(r.kind, undefined, JSON.stringify(r));
  assert.deepEqual(r.providesRoles, ['logging']);
  assert.equal(r.suggestedCompanions.length, 1);
  assert.equal(r.suggestedCompanions[0].role, 'logging');
});

test('loader loads clean when neither providesRoles nor suggestedCompanions is declared (AC-1401-1)', async () => {
  const dir = await writeBlueprint({
    slug: 'scratch-none', version: '1.0.0', category: 'observability',
    contributions: [],
  });
  const r = await loadBlueprint(dir);
  assert.equal(r.kind, undefined, JSON.stringify(r));
  assert.equal(r.providesRoles, undefined);
  assert.equal(r.suggestedCompanions, undefined);
});

test('loader refuses providesRoles value that fails the lower camelCase pattern (AC-1401-2)', async () => {
  const dir = await writeBlueprint({
    slug: 'scratch-bad-role', version: '1.0.0', category: 'observability',
    providesRoles: ['Logging'],
    contributions: [
      { id: 'ADR-9001-scratch-bad-role-shape', kind: 'adr', path: 'adrs/adr-9001.json', scope: 'global', topic: 'Logging' },
    ],
  }, { 'adrs/adr-9001.json': '{}' });
  const r = await loadBlueprint(dir);
  assert.equal(r.kind, 'validation');
  assert.match(r.message, /providesRoles\[0\] 'Logging' is not lower camelCase/);
});

test('loader refuses suggestedCompanions entry with empty or whitespace-only reason (AC-1401-2)', async () => {
  const dir = await writeBlueprint({
    slug: 'scratch-bad-reason', version: '1.0.0', category: 'application',
    suggestedCompanions: [{ role: 'logging', reason: '   ' }],
    contributions: [],
  });
  const r = await loadBlueprint(dir);
  assert.equal(r.kind, 'validation');
  assert.match(r.message, /suggestedCompanions\[0\]\.reason for role 'logging' must be a non-empty string/);
});

test('loader refuses em-dash in suggestedCompanions reason (AC-1401-2)', async () => {
  const dir = await writeBlueprint({
    slug: 'scratch-emdash', version: '1.0.0', category: 'application',
    suggestedCompanions: [{ role: 'logging', reason: 'One — two.' }],
    contributions: [],
  });
  const r = await loadBlueprint(dir);
  assert.equal(r.kind, 'validation');
  assert.match(r.message, /contains an em-dash/);
});

test('loader refuses emoji in suggestedCompanions reason (AC-1401-2)', async () => {
  const dir = await writeBlueprint({
    slug: 'scratch-emoji', version: '1.0.0', category: 'application',
    suggestedCompanions: [{ role: 'logging', reason: 'One two \u{1F600} three.' }],
    contributions: [],
  });
  const r = await loadBlueprint(dir);
  assert.equal(r.kind, 'validation');
  assert.match(r.message, /contains an emoji/);
});

test('loader refuses providesRoles without a paired scope:global ADR on the topic string (AC-1401-3)', async () => {
  const dir = await writeBlueprint({
    slug: 'scratch-no-paired-adr', version: '1.0.0', category: 'observability',
    providesRoles: ['logging'],
    contributions: [
      { id: 'ADR-9001-scratch-no-paired-adr-other', kind: 'adr', path: 'adrs/adr-9001.json' },
    ],
  }, { 'adrs/adr-9001.json': '{}' });
  const r = await loadBlueprint(dir);
  assert.equal(r.kind, 'validation');
  assert.match(r.message, /providesRoles\[\] names 'logging' but no scope:global ADR carries topic 'logging'/);
});
