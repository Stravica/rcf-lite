// draft-persistence-round-trip probe for application-forms-wizard
// v1.2.2.
//
// Verifies AC-24105-1 on the server-side branch: POST /drafts with
// { step, field, value } persists the answer, and a subsequent
// fresh GET /drafts returns the same field with an updatedAt
// timestamp. Two round trips with different values prove
// persistence is real state, not a per-request echo.
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
    const seed1 = { step: 'contact-details', field: 'fullName', value: 'Probe Runner' };
    const post1 = await fetch(`${fixture.baseUrl}/drafts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(seed1),
    });
    const get1 = await fetch(`${fixture.baseUrl}/drafts`);
    const get1Body = await get1.text();
    const drafts1 = JSON.parse(get1Body);
    const key1 = `${seed1.step}.${seed1.field}`;
    const persisted1 = drafts1.fields && drafts1.fields[key1] === seed1.value;
    const stamped1 = typeof drafts1.updatedAt === 'string' && drafts1.updatedAt.length > 0;

    // Second round: overwrite the same key with a new value to
    // prove the store carries state across two calls.
    const seed2 = { step: 'contact-details', field: 'fullName', value: 'Second Value' };
    const post2 = await fetch(`${fixture.baseUrl}/drafts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(seed2),
    });
    const get2 = await fetch(`${fixture.baseUrl}/drafts`);
    const get2Body = await get2.text();
    const drafts2 = JSON.parse(get2Body);
    const persisted2 = drafts2.fields && drafts2.fields[key1] === seed2.value;
    const overwritten = drafts1.fields[key1] !== drafts2.fields[key1];

    const pass = post1.status === 200 && get1.status === 200 && post2.status === 200 && get2.status === 200
      && persisted1 && stamped1 && persisted2 && overwritten;
    results.push({
      anchorAcId: 'application-forms-wizard-AC-24105-1',
      anchorReqId: 'application-forms-wizard-REQ-005',
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `draft persisted and overwritten: ${key1} first="${seed1.value}" then="${seed2.value}" updatedAt=${drafts2.updatedAt}`
        : `draft round-trip fault: persisted1=${persisted1} stamped1=${stamped1} persisted2=${persisted2} overwritten=${overwritten}`,
      evidence: evidenceFromResponse({
        route: '/drafts',
        response: get2,
        bodyText: get2Body,
        extraFields: {
          input: { post1: seed1, post2: seed2 },
          derived: { valueAfterFirst: drafts1.fields[key1], valueAfterSecond: drafts2.fields[key1], updatedAt: drafts2.updatedAt, overwritten },
        },
      }),
    });
    return { results };
  } finally {
    await fixture.close();
  }
}
