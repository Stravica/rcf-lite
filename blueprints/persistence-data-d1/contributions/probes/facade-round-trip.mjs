// Facade round-trip probe for persistence-data-d1.
//
// REQ-001 says every persistent entity lives in one D1 database
// accessed through one facade module. The 'facadeReady' event
// count-per-open is fixture-added observation, not text stated on
// REQ-001; per closure-3 §(2) that row is de-claimed
// (anchorAcId=null, conformanceOnly true) with the limitation.
//
// AC-13101-2 (named domain verbs) is observable: the probe calls
// facade.insertItem, facade.findItemByName, facade.deleteItem -- no
// raw SQL leaves the facade. Kept.
//
// AC-13101-4 (missing binding refusal with d1BindingMissing) is
// observable and kept.
//
// Every detail line begins with the first eight words of the
// anchored AC or REQ text.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createD1Binding } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-persistence-data-d1/src/d1-binding-mock.mjs';
import { openFacade } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-persistence-data-d1/src/facade.mjs';

export const anchorAcId = 'AC-13101-2';
export const accountBound = false;
const AC2 = 'The facade exposes named domain verbs for every';
const AC4 = 'Dependency not ready: D1 binding absent from the';
const REQ1_LIM = `REQ-001 requires the facade module to be the SOLE reader of the D1 binding across the project's source modules (a repo-scan property, plus the runtime binding shape). A fixture-added 'facadeReady' event count per open is not evidence stated on REQ-001.`;

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
      limitation: REQ1_LIM,
      verdict: ready.length === 1 && facade.bindingName === 'DB' ? 'pass' : 'fail',
      detail: `observed facadeReady x${ready.length} on bindingName='${facade.bindingName}'; migrations=${JSON.stringify(facade.migrationsApplied)}. Fixture-added event; not stated on REQ-001.`,
      evidence: { event: ready[0], bindingName: facade.bindingName, migrationsApplied: facade.migrationsApplied, bodyExcerpt: `facadeReady=${ready.length} binding=${facade.bindingName}` },
    });
    const ins = await facade.insertItem({ name: 'probe-item-1', note: 'from probe' });
    rowId = ins.rowId;
    results.push({
      anchorAcId: 'AC-13101-2',
      verdict: Number.isInteger(ins.rowId) && ins.rowId > 0 && ins.changes === 1 ? 'pass' : 'fail',
      detail: `${AC2} persistence operation the domain requires  -  observed insertItem returned real rowId=${ins.rowId} changes=${ins.changes} through the facade's named domain verb (no raw SQL).`,
      evidence: { rowId: ins.rowId, changes: ins.changes, bodyExcerpt: `insertItem rowId=${ins.rowId} changes=${ins.changes}` },
    });
    const found = await facade.findItemByName('probe-item-1');
    results.push({
      anchorAcId: 'AC-13101-2',
      verdict: found && found.name === 'probe-item-1' && found.id === ins.rowId ? 'pass' : 'fail',
      detail: `${AC2} persistence operation the domain requires  -  observed findItemByName returned id=${found?.id} name=${found?.name} through the facade's named domain verb.`,
      evidence: { found, rowIdOnRead: found?.id, bodyExcerpt: `findItemByName id=${found?.id} name=${found?.name}` },
    });
    const del = await facade.deleteItem({ name: 'probe-item-1' });
    const after = await facade.findItemByName('probe-item-1');
    results.push({
      anchorAcId: 'AC-13101-2',
      verdict: del.changes === 1 && after === null ? 'pass' : 'fail',
      detail: `${AC2} persistence operation the domain requires  -  observed deleteItem changes=${del.changes}; find-after-delete=${after ? 'present' : 'absent'} through the facade's named delete then find verbs.`,
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
