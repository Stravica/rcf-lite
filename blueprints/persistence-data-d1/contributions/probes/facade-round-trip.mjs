// Facade round-trip probe for persistence-data-d1.
//
// The 'facadeReady' event count-per-open is a fixture-added observation
// not stated on any shipped AC; the nearest shipped AC on facade shape
// is AC-13101-1 (single source-tree reader of the binding). Row
// de-claimed (conformanceOnly, anchorAcId=null) with the limitation
// naming AC-13101-1.
//
// AC-13101-2 (named domain verbs; no general-purpose query method
// accepting raw SQL) requires an exhaustive scan of the facade's
// public surface to prove absence of a general-purpose query method
// on top of the runtime CRUD observation. This probe observes the
// runtime CRUD half only; rows de-claimed with the limitation naming
// AC-13101-2.
//
// AC-13101-4 (missing-binding refusal with d1BindingMissing) IS
// observable and kept as a real AC anchor.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createD1Binding } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-persistence-data-d1/src/d1-binding-mock.mjs';
import { openFacade } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-persistence-data-d1/src/facade.mjs';

export const anchorAcId = 'AC-13101-4';
export const accountBound = false;
const AC4 = 'Dependency not ready: D1 binding absent from the';
const LIM_13101_1 = `AC-13101-1: requires exactly one source-tree module to read the D1 binding from the Worker env. A fixture-added 'facadeReady' event count per open is not evidence of the import-graph sole-reader property AC-13101-1 states.`;
const LIM_13101_2 = `AC-13101-2: requires the facade to expose named domain verbs for every persistence operation AND not to export the raw D1 binding or a general-purpose query method accepting a raw SQL string. Runtime CRUD round-trips through the facade demonstrate the named verbs work; a probe would still need an exhaustive scan of the facade's public surface to prove absence of a general-purpose query method.`;

export default async function runProbe() {
  const dir = await mkdtemp(join(tmpdir(), 'rcf-d1-'));
  const path = process.env.RCF_FIXTURE_D1_SQLITE_PATH || join(dir, 'd1.sqlite');
  const events = [];
  const results = [];
  const binding = createD1Binding({ path });
  const env = { DB: binding };
  let rowId = null;
  try {
    const facade = await openFacade({ env, eventSink: (e) => events.push(e) });
    const ready = events.filter((e) => e.event === 'facadeReady');
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: LIM_13101_1,
      verdict: ready.length === 1 && facade.bindingName === 'DB' ? 'pass' : 'fail',
      detail: `observed facadeReady x${ready.length} on bindingName='${facade.bindingName}'; migrations=${JSON.stringify(facade.migrationsApplied)}. Fixture-added event; the import-graph sole-reader property on AC-13101-1 is not observed at runtime.`,
      evidence: { event: ready[0], bindingName: facade.bindingName, migrationsApplied: facade.migrationsApplied, bodyExcerpt: `facadeReady=${ready.length} binding=${facade.bindingName}` },
    });
    const ins = await facade.insertItem({ name: 'probe-item-1', note: 'from probe' });
    rowId = ins.rowId;
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: LIM_13101_2,
      verdict: Number.isInteger(ins.rowId) && ins.rowId > 0 && ins.changes === 1 ? 'pass' : 'fail',
      detail: `observed insertItem returned real rowId=${ins.rowId} changes=${ins.changes} through the facade's named insert verb (no raw SQL leaves the facade at runtime).`,
      evidence: { rowId: ins.rowId, changes: ins.changes, bodyExcerpt: `insertItem rowId=${ins.rowId} changes=${ins.changes}` },
    });
    const found = await facade.findItemByName('probe-item-1');
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: LIM_13101_2,
      verdict: found && found.name === 'probe-item-1' && found.id === ins.rowId ? 'pass' : 'fail',
      detail: `observed findItemByName returned id=${found?.id} name=${found?.name} through the facade's named find verb.`,
      evidence: { found, rowIdOnRead: found?.id, bodyExcerpt: `findItemByName id=${found?.id} name=${found?.name}` },
    });
    const del = await facade.deleteItem({ name: 'probe-item-1' });
    const after = await facade.findItemByName('probe-item-1');
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: LIM_13101_2,
      verdict: del.changes === 1 && after === null ? 'pass' : 'fail',
      detail: `observed deleteItem changes=${del.changes}; find-after-delete=${after ? 'present' : 'absent'} through the facade's named delete and find verbs.`,
      evidence: { rowIdCreatedThenDeleted: rowId, deleteChanges: del.changes, presentAfterDelete: Boolean(after), bodyExcerpt: `deleteItem changes=${del.changes} presentAfterDelete=${Boolean(after)}` },
    });
    binding.__closeForFixture();
    let refusal = null;
    try { await openFacade({ env: {}, eventSink: (e) => events.push(e) }); }
    catch (e) { refusal = { message: e.message, kind: e.kind, bindingName: e.bindingName }; }
    const readyAfterRefusal = events.filter((e) => e.event === 'facadeReady').length;
    results.push({
      anchorAcId: 'AC-13101-4',
      verdict: refusal?.kind === 'd1BindingMissing' && refusal?.bindingName === 'DB' && readyAfterRefusal === 1 ? 'pass' : 'fail',
      detail: `${AC4} Worker env  -  observed refusal kind='${refusal?.kind}' bindingName='${refusal?.bindingName}' after openFacade with env={}; facadeReady after refusal=${readyAfterRefusal} (unchanged; no extra event fired).`,
      evidence: { ...refusal, refusalMessage: refusal?.message, kind: refusal?.kind, bindingName: refusal?.bindingName, missingKey: refusal?.bindingName, bodyExcerpt: `refusal kind=${refusal?.kind} bindingName=${refusal?.bindingName}` },
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return { results, extra: { envDeclared: ['RCF_FIXTURE_D1_SQLITE_PATH'], rowIdCreatedThenDeleted: rowId } };
}
