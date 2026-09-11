// Facade round-trip probe for persistence-data-d1.
// Anchors: REQ-001-persistence-data-d1 (facade one-fires-per-open;
// no shipped AC states positive facadeReady shape), AC-13101-2
// (named domain verbs), AC-13101-4 (missing binding refusal).
// Every detail line begins with the first eight words of the
// anchored AC or REQ text.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createD1Binding } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-persistence-data-d1/src/d1-binding-mock.mjs';
import { openFacade } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-persistence-data-d1/src/facade.mjs';

export const anchorAcId = 'AC-13101-2';
export const accountBound = false;
const REQ1 = 'Every persistent entity lives in one D1 database';
const AC2 = 'The facade exposes named domain verbs for every';
const AC4 = 'Dependency not ready: D1 binding absent from the';

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
      anchorAcId: 'REQ-001-persistence-data-d1',
      verdict: ready.length === 1 && facade.bindingName === 'DB' ? 'pass' : 'fail',
      detail: `${REQ1} accessed through one facade module  -  observed facadeReady x${ready.length} on bindingName='${facade.bindingName}'; migrations=${JSON.stringify(facade.migrationsApplied)}; no shipped AC states the positive one-fires-per-open shape.`,
      evidence: { facadeReady: ready[0], migrationsApplied: facade.migrationsApplied },
    });
    const ins = await facade.insertItem({ name: 'probe-item-1', note: 'from probe' });
    rowId = ins.rowId;
    results.push({
      anchorAcId: 'AC-13101-2',
      verdict: Number.isInteger(ins.rowId) && ins.rowId > 0 && ins.changes === 1 ? 'pass' : 'fail',
      detail: `${AC2} persistence operation the domain requires  -  observed insertItem returned real rowId=${ins.rowId} changes=${ins.changes} through the facade's named domain verb (no raw SQL).`,
      evidence: { rowId: ins.rowId, changes: ins.changes },
    });
    const found = await facade.findItemByName('probe-item-1');
    results.push({
      anchorAcId: 'AC-13101-2',
      verdict: found && found.name === 'probe-item-1' && found.id === ins.rowId ? 'pass' : 'fail',
      detail: `${AC2} persistence operation the domain requires  -  observed findItemByName returned id=${found?.id} name=${found?.name} through the facade's named domain verb.`,
      evidence: { found, rowIdOnRead: found?.id },
    });
    const del = await facade.deleteItem({ name: 'probe-item-1' });
    const after = await facade.findItemByName('probe-item-1');
    results.push({
      anchorAcId: 'AC-13101-2',
      verdict: del.changes === 1 && after === null ? 'pass' : 'fail',
      detail: `${AC2} persistence operation the domain requires  -  observed deleteItem changes=${del.changes}; find-after-delete=${after ? 'present' : 'absent'} through the facade's named delete then find verbs.`,
      evidence: { rowIdCreatedThenDeleted: rowId, deleteChanges: del.changes, presentAfterDelete: Boolean(after) },
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
      evidence: refusal,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return { results, extra: { envDeclared: ['RCF_FIXTURE_D1_SQLITE_PATH'], rowIdCreatedThenDeleted: rowId } };
}
