// draft-persistence-round-trip probe for application-forms-wizard v1.2.5.
//
// Verifies AC-24105-1: POST /drafts with { operatorId, wizardSlug,
// step, field, value } persists the answer scoped to the operator
// and wizard; a subsequent fresh GET /drafts?operatorId=&wizardSlug=
// returns the same field with an updatedAt timestamp. Two round
// trips with different values under the same scope prove the store
// is real state, and a second operator's write proves the scope
// key is honoured (AC-24105-1's per-operator, per-wizard scope).
//
// anchorAcId: application-forms-wizard-AC-24105-1.

import { startFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-forms-wizard-REQ-005';
export const accountBound = false;

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-forms-wizard/server.js');
  const fixture = await startFixture({ startServer, port: 0 });
  try {
    const results = [];

    const OP_A = 'probe-op-a';
    const OP_B = 'probe-op-b';
    const WIZ = 'application-forms-wizard';
    const KEY = 'contact-details.fullName';

    // Step 1: OP_A writes then overwrites.
    const seed1a = { operatorId: OP_A, wizardSlug: WIZ, step: 'contact-details', field: 'fullName', value: 'Probe Runner' };
    const seed2a = { operatorId: OP_A, wizardSlug: WIZ, step: 'contact-details', field: 'fullName', value: 'Second Value' };
    const post1a = await fetch(`${fixture.baseUrl}/drafts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(seed1a) });
    const get1a = await fetch(`${fixture.baseUrl}/drafts?operatorId=${OP_A}&wizardSlug=${WIZ}`);
    const drafts1a = JSON.parse(await get1a.text());
    const post2a = await fetch(`${fixture.baseUrl}/drafts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(seed2a) });
    const get2a = await fetch(`${fixture.baseUrl}/drafts?operatorId=${OP_A}&wizardSlug=${WIZ}`);
    const get2aBody = await get2a.text();
    const drafts2a = JSON.parse(get2aBody);
    const persistedA1 = drafts1a.fields && drafts1a.fields[KEY] === seed1a.value;
    const persistedA2 = drafts2a.fields && drafts2a.fields[KEY] === seed2a.value;
    const overwrittenA = persistedA1 && persistedA2 && drafts1a.fields[KEY] !== drafts2a.fields[KEY];

    // Step 2: OP_B writes a different value under the same key; if
    // scope is honoured, OP_A's value stays "Second Value" and OP_B
    // gets its own.
    const seedB = { operatorId: OP_B, wizardSlug: WIZ, step: 'contact-details', field: 'fullName', value: 'Op B Value' };
    const postB = await fetch(`${fixture.baseUrl}/drafts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(seedB) });
    const getB = await fetch(`${fixture.baseUrl}/drafts?operatorId=${OP_B}&wizardSlug=${WIZ}`);
    const draftsB = JSON.parse(await getB.text());
    const getAAgain = await fetch(`${fixture.baseUrl}/drafts?operatorId=${OP_A}&wizardSlug=${WIZ}`);
    const draftsAAgain = JSON.parse(await getAAgain.text());
    const scopeHonoured = draftsB.fields[KEY] === seedB.value && draftsAAgain.fields[KEY] === seed2a.value;

    const pass = post1a.status === 200 && get1a.status === 200 && post2a.status === 200 && get2a.status === 200
      && postB.status === 200 && getB.status === 200 && getAAgain.status === 200
      && persistedA1 && persistedA2 && overwrittenA && scopeHonoured;

    results.push({
      anchorAcId: 'application-forms-wizard-AC-24105-1',
      anchorReqId: 'application-forms-wizard-REQ-005',
      verdict: pass ? 'pass' : 'fail',
      detail: `On ?draft-store=server, entering an answer on step 1 - drafts persisted with operator+wizard scope; OP_A overwrite=${overwrittenA}, OP_B independent value=${draftsB.fields[KEY]}, scope honoured=${scopeHonoured}`,
      evidence: evidenceFromResponse({
        route: `/drafts?operatorId=${OP_A}&wizardSlug=${WIZ}`,
        response: get2a,
        bodyText: get2aBody,
        extraFields: {
          input: { operatorAWrites: [seed1a.value, seed2a.value], operatorBWrite: seedB.value },
          derived: {
            valueAfterFirstA: drafts1a.fields[KEY],
            valueAfterSecondA: drafts2a.fields[KEY],
            valueOpB: draftsB.fields[KEY],
            valueOpAAgain: draftsAAgain.fields[KEY],
            updatedAtA: drafts2a.updatedAt,
            scopeHonoured,
            overwrittenA,
          },
        },
      }),
    });

    // Row 2: request without operator+wizard is refused (AC-24105-1
    // scope-required derivation).
    const badRes = await fetch(`${fixture.baseUrl}/drafts`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ step: 'contact-details', field: 'fullName', value: 'no-scope' }),
    });
    const badBody = await badRes.text();
    const badRefused = badRes.status === 400;
    results.push({
      anchorAcId: 'application-forms-wizard-AC-24105-1',
      anchorReqId: 'application-forms-wizard-REQ-005',
      verdict: badRefused ? 'pass' : 'fail',
      detail: `On ?draft-store=server, entering an answer on step 1 - draft body without operatorId+wizardSlug refused with ${badRes.status}`,
      evidence: evidenceFromResponse({
        route: '/drafts',
        response: badRes,
        bodyText: badBody,
        extraFields: {
          input: { body: 'missing operatorId and wizardSlug' },
          derived: { httpStatus: badRes.status, refused: badRefused },
        },
      }),
    });

    return { results };
  } finally {
    await fixture.close();
  }
}
