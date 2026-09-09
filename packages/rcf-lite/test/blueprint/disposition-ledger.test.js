// Unit tests for src/blueprint/disposition-ledger.js and the
// dispositions read-only sub-verb.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  initialiseLedger,
  ledgerRelPath,
  readLedger,
  upsertLedgerRecord,
  writeLedger,
} from '../../src/blueprint/disposition-ledger.js';
import { renderDispositions } from '../../src/blueprint/dispositions.js';

const now = new Date('2026-09-09T12:00:00Z');

test('initialiseLedger writes one record per AC with the correct action per source disposition', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-ledger-'));
  const res = await initialiseLedger({
    projectRoot: root, slug: 'demo',
    acDescriptors: [
      { id: 'AC-1', storyId: 'US-1', sourceDisposition: 'fixed' },
      { id: 'AC-2', storyId: 'US-1', sourceDisposition: 'template' },
      { id: 'AC-3', storyId: 'US-2' },
    ],
    now,
  });
  assert.equal(res.alreadyExisted, false);
  assert.equal(res.recordCount, 3);
  const doc = JSON.parse(await readFile(join(root, res.path), 'utf8'));
  assert.equal(doc.slug, 'demo');
  assert.equal(doc.schemaVersion, 1);
  assert.equal(doc.records.length, 3);
  const [a, b, c] = doc.records;
  assert.equal(a.action, 'accepted');
  assert.equal(a.reason, 'fixed-mechanism-inherited');
  assert.equal(a.sourceDisposition, 'fixed');
  assert.equal(b.action, 'pending-disposition');
  assert.equal(b.sourceDisposition, 'template');
  assert.equal(c.action, 'pending-disposition');
  assert.equal(c.sourceDisposition, undefined);
});

test('initialiseLedger is idempotent: an existing ledger is left byte-identical', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-ledger-'));
  await initialiseLedger({
    projectRoot: root, slug: 'demo',
    acDescriptors: [{ id: 'AC-1', storyId: 'US-1' }],
    now,
  });
  const before = await readFile(join(root, ledgerRelPath('demo')), 'utf8');
  const second = await initialiseLedger({
    projectRoot: root, slug: 'demo',
    acDescriptors: [{ id: 'AC-9', storyId: 'US-9' }],
    now,
  });
  const after = await readFile(join(root, ledgerRelPath('demo')), 'utf8');
  assert.equal(second.alreadyExisted, true);
  assert.equal(before, after, 'ledger must not be rewritten on re-apply');
});

test('upsertLedgerRecord updates an existing record by acId and records resolvedAt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-ledger-'));
  await initialiseLedger({
    projectRoot: root, slug: 'demo',
    acDescriptors: [{ id: 'AC-1', storyId: 'US-1', sourceDisposition: 'template' }],
    now,
  });
  const upd = await upsertLedgerRecord({
    projectRoot: root, slug: 'demo',
    record: { acId: 'AC-1', storyId: 'US-1', action: 'accepted', reason: 'project convention already ships this shape', resolvedAt: '2026-09-09', resolvedBy: 'applying-agent' },
  });
  assert.equal(upd.updated, true);
  const doc = await readLedger(root, 'demo');
  assert.equal(doc.records.length, 1, 'update must not duplicate the record');
  assert.equal(doc.records[0].action, 'accepted');
  assert.equal(doc.records[0].resolvedAt, '2026-09-09');
  // AC-2 (AC-10 spec): a template AC escalated as pending-operator gains escalatedAt.
  await upsertLedgerRecord({
    projectRoot: root, slug: 'demo',
    record: { acId: 'AC-2', storyId: 'US-1', sourceDisposition: 'template', action: 'pending-operator', escalatedAt: '2026-09-09', escalatedToOperator: true },
  });
  const doc2 = await readLedger(root, 'demo');
  const pend = doc2.records.find((r) => r.acId === 'AC-2');
  assert.equal(pend.action, 'pending-operator');
  assert.equal(pend.escalatedAt, '2026-09-09');
});

test('writeLedger refuses an unknown action value', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-ledger-'));
  const res = await writeLedger({
    projectRoot: root, slug: 'demo',
    records: [{ acId: 'AC-1', storyId: 'US-1', action: 'ambivalent' }],
  });
  assert.match(res.error, /action must be one of/);
});

test('renderDispositions returns present:false when no ledger exists (JSON path)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-ledger-'));
  const rendered = await renderDispositions({ projectRoot: root, slug: 'missing', asJson: true });
  assert.equal(rendered.exitCode, 0);
  const doc = JSON.parse(rendered.output);
  assert.equal(doc.slug, 'missing');
  assert.equal(doc.present, false);
});

test('renderDispositions returns the ledger records (JSON path)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-ledger-'));
  await initialiseLedger({
    projectRoot: root, slug: 'demo',
    acDescriptors: [{ id: 'AC-1', storyId: 'US-1', sourceDisposition: 'template' }],
    now,
  });
  const rendered = await renderDispositions({ projectRoot: root, slug: 'demo', asJson: true });
  const doc = JSON.parse(rendered.output);
  assert.equal(doc.present, true);
  assert.equal(doc.records.length, 1);
  assert.equal(doc.records[0].action, 'pending-disposition');
});
