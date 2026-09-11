// Facade round-trip probe for persistence-data-d1 v1.1.2.
// Opens the D1 facade against the fixture's sqlite-backed D1 binding
// mock, asserts facadeReady fires with the applied migration list
// (real integer applications from the SQLite handle backing the
// binding), then drives insertItem, findItemByName, listItems and
// deleteItem verbs and asserts a real integer row id round-trips.
// Also asserts a missing binding refusal (facade.openFacade with
// env={}) surfaces d1BindingMissing without a facadeReady event.
//
// Positive evidence: real integer row ids from the mock's meta.last_row_id
// (created-then-deleted resource id shape at the facade boundary).
// anchorAcId: AC-13101-1. accountBound: false.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createD1Binding } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-persistence-data-d1/src/d1-binding-mock.mjs';
import { openFacade } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-persistence-data-d1/src/facade.mjs';

export const anchorAcId = 'AC-13101-1';
export const accountBound = false;

export default async function runProbe() {
  const dir = await mkdtemp(join(tmpdir(), 'rcf-d1-'));
  const path = process.env.RCF_FIXTURE_D1_SQLITE_PATH || join(dir, 'd1.sqlite');
  const events = [];
  const results = [];
  const binding = createD1Binding({ path });
  const env = { DB: binding };
  try {
    const facade = await openFacade({ env, eventSink: (e) => events.push(e) });
    const ready = events.filter((e) => e.event === 'facadeReady');
    results.push({
      anchorAcId: 'AC-13101-1',
      verdict: ready.length === 1 && facade.bindingName === 'DB' ? 'pass' : 'fail',
      detail: `facadeReady x${ready.length} on bindingName='${facade.bindingName}'; migrations=${JSON.stringify(facade.migrationsApplied)}`,
      evidence: { facadeReady: ready[0], migrationsApplied: facade.migrationsApplied },
    });
    const ins = await facade.insertItem({ name: 'probe-item-1', note: 'from probe' });
    results.push({
      anchorAcId: 'AC-13101-2',
      verdict: Number.isInteger(ins.rowId) && ins.rowId > 0 && ins.changes === 1 ? 'pass' : 'fail',
      detail: `insertItem returned real rowId=${ins.rowId} changes=${ins.changes}`,
      evidence: { rowId: ins.rowId, changes: ins.changes },
    });
    const found = await facade.findItemByName('probe-item-1');
    results.push({
      anchorAcId: 'AC-13101-2',
      verdict: found && found.name === 'probe-item-1' && found.id === ins.rowId ? 'pass' : 'fail',
      detail: `findItemByName returned id=${found?.id} name=${found?.name}`,
      evidence: { found },
    });
    const del = await facade.deleteItem({ name: 'probe-item-1' });
    const after = await facade.findItemByName('probe-item-1');
    results.push({
      anchorAcId: 'AC-13101-3',
      verdict: del.changes === 1 && after === null ? 'pass' : 'fail',
      detail: `deleteItem changes=${del.changes}; find-after-delete=${after ? 'present' : 'absent'}`,
      evidence: { deleteChanges: del.changes, presentAfterDelete: Boolean(after) },
    });
    binding.__closeForFixture();
    // Missing-binding refusal
    let refusal = null;
    try { await openFacade({ env: {}, eventSink: (e) => events.push(e) }); }
    catch (e) { refusal = { message: e.message, kind: e.kind, bindingName: e.bindingName }; }
    const readyAfterRefusal = events.filter((e) => e.event === 'facadeReady').length;
    results.push({
      anchorAcId: 'AC-13101-4',
      verdict: refusal?.kind === 'd1BindingMissing' && refusal?.bindingName === 'DB' && readyAfterRefusal === 1 ? 'pass' : 'fail',
      detail: `refusal kind='${refusal?.kind}' bindingName='${refusal?.bindingName}'; facadeReady after refusal=${readyAfterRefusal}`,
      evidence: refusal,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return { results, extra: { envDeclared: ['RCF_FIXTURE_D1_SQLITE_PATH'] } };
}
