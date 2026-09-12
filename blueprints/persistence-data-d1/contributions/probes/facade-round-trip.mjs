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
// the strict-evidence contract tightening: AC-13101-4 (missing-binding refusal with
// d1BindingMissing) is observed via the local fixture openFacade
// throwing on a missing DB binding. The refusal never reaches the D1
// engine, so no engine-returned request id or resource identifier is
// available; the row is de-claimed to conformanceOnly naming AC-13101-4.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createD1Binding } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-persistence-data-d1/src/d1-binding-mock.mjs';
import { openFacade } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-persistence-data-d1/src/facade.mjs';

// The module anchor names the AC this probe observes as a property;
// individual rows may still de-claim (conformanceOnly) when the
// evidence shape does not carry an engine-returned identifier.
export const anchorAcId = 'AC-13101-4';
export const accountBound = false;
const AC4 = 'Dependency not ready: D1 binding absent from the';
const LIM_13101_1 = `AC-13101-1: requires exactly one source-tree module to read the D1 binding from the Worker env. A fixture-added 'facadeReady' event count per open is not evidence of the import-graph sole-reader property AC-13101-1 states.`;
const LIM_13101_2 = `AC-13101-2: requires the facade to expose named domain verbs for every persistence operation AND not to export the raw D1 binding or a general-purpose query method accepting a raw SQL string. Runtime CRUD round-trips through the facade demonstrate the named verbs work; a probe would still need an exhaustive scan of the facade's public surface to prove absence of a general-purpose query method.`;
const LIM_13101_4 = `AC-13101-4: the missing-binding refusal is thrown by the local fixture's openFacade before any call reaches the D1 engine. No engine-returned request id or resource identifier is available on the refusal path; the credential-leak-absent predicate is observed, but the identifier half of the strict-evidence contract requires an id the engine or its response headers produced.`;

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
    // Sentinels stashed on the env passed alongside the missing DB
    // binding. AC-13101-4 requires the refusal to leak neither the
    // account id nor the API token; the probe drives a positive predicate by
    // proving neither sentinel appears anywhere in the refusal error's
    // message, kind, bindingName, stack or JSON serialisation. Row
    // de-claimed to conformanceOnly (the strict-evidence contract): the refusal never
    // reaches the D1 engine so no engine-returned identifier exists.
    const accountIdSentinel = 'acct-sentinel-' + Math.random().toString(36).slice(2, 12);
    const apiTokenSentinel = 'token-sentinel-' + Math.random().toString(36).slice(2, 12);
    let refusal = null;
    let refusalErr = null;
    try {
      await openFacade({
        env: { CLOUDFLARE_ACCOUNT_ID: accountIdSentinel, CLOUDFLARE_API_TOKEN: apiTokenSentinel },
        eventSink: (e) => events.push(e),
      });
    } catch (e) {
      refusalErr = e;
      refusal = { message: e.message, kind: e.kind, bindingName: e.bindingName };
    }
    const refusalString = [
      refusalErr?.message ?? '',
      refusalErr?.kind ?? '',
      refusalErr?.bindingName ?? '',
      refusalErr?.stack ?? '',
      (() => { try { return JSON.stringify(refusalErr, Object.getOwnPropertyNames(refusalErr || {})); } catch { return ''; } })(),
    ].join(' || ');
    const accountIdInRefusal = accountIdSentinel.length > 0 && refusalString.includes(accountIdSentinel);
    const apiTokenInRefusal = apiTokenSentinel.length > 0 && refusalString.includes(apiTokenSentinel);
    const credentialLeakAbsent = accountIdInRefusal === false && apiTokenInRefusal === false;
    const readyAfterRefusal = events.filter((e) => e.event === 'facadeReady').length;
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: LIM_13101_4,
      verdict: refusal?.kind === 'd1BindingMissing' && refusal?.bindingName === 'DB' && readyAfterRefusal === 1 && credentialLeakAbsent ? 'pass' : 'fail',
      detail: `observed refusal kind='${refusal?.kind}' bindingName='${refusal?.bindingName}' after openFacade with env carrying sentinel account-id and api-token but no DB binding; accountIdInRefusal=${accountIdInRefusal}; apiTokenInRefusal=${apiTokenInRefusal}; credentialLeakAbsent=${credentialLeakAbsent}; facadeReady after refusal=${readyAfterRefusal} (unchanged; no extra event fired). Refusal never reaches the D1 engine; no engine-returned identifier is available.`,
      evidence: {
        ...refusal,
        refusalMessage: refusal?.message,
        kind: refusal?.kind,
        bindingName: refusal?.bindingName,
        missingKey: refusal?.bindingName,
        accountIdInRefusal,
        apiTokenInRefusal,
        credentialLeakAbsent,
        readyAfterRefusal,
        bodyExcerpt: `refusal kind=${refusal?.kind} bindingName=${refusal?.bindingName} credentialLeakAbsent=${credentialLeakAbsent}`,
      },
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return { results, extra: { envDeclared: ['RCF_FIXTURE_D1_SQLITE_PATH'], rowIdCreatedThenDeleted: rowId } };
}
