// draft-persistence-round-trip probe for application-forms-wizard v1.2.0.
//
// Verifies that the wizard commits partial answers to a draft store
// between steps (REQ-005). POSTs a draft update, then GETs /drafts
// and asserts the field appears in the returned payload with an
// updatedAt timestamp. Records the request id and body excerpt as
// evidence.
//
// anchorReqId: application-forms-wizard-REQ-005.

import { startPatchedFixture, evidenceFromResponse } from './probe-utils.mjs';

export const anchorReqId = 'application-forms-wizard-REQ-005';
export const accountBound = false;

export default async function runProbe() {
  const { startServer } = await import('../../../../packages/rcf-lite/test/fixtures/probe-pack-application-forms-wizard/server.js');
  const fixture = await startPatchedFixture({ startServer, port: 0 });
  try {
    const results = [];
    const seed = { step: 'contact-details', field: 'fullName', value: 'Probe Runner' };
    const postRes = await fetch(`${fixture.baseUrl}/drafts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(seed),
    });
    const postBody = await postRes.text();

    const getRes = await fetch(`${fixture.baseUrl}/drafts`);
    const getBody = await getRes.text();
    const drafts = JSON.parse(getBody);
    const key = `${seed.step}.${seed.field}`;
    const persisted = drafts.fields && drafts.fields[key] === seed.value;
    const stamped = typeof drafts.updatedAt === 'string' && drafts.updatedAt.length > 0;
    const pass = postRes.status === 200 && getRes.status === 200 && persisted && stamped;
    results.push({
      anchorReqId: 'application-forms-wizard-REQ-005',
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `draft persisted: ${key}="${seed.value}" updatedAt=${drafts.updatedAt}`
        : `draft round-trip fault: post=${postRes.status} get=${getRes.status} persisted=${persisted} stamped=${stamped}`,
      evidence: evidenceFromResponse({ route: '/drafts', response: getRes, bodyText: getBody, extraFields: { postStatus: postRes.status, seededField: key, updatedAt: drafts.updatedAt } }),
    });
    return { results };
  } finally {
    await fixture.close();
  }
}
