// application-account-settings probe: profile form autocomplete
// tokens (AC-25102-1). AC-25102-1 requires <form data-surface="profile">
// with inputs carrying autocomplete tokens "name", "email", "bday",
// and "country". Derived observation: parse the form's input elements
// and match each required field to the autocomplete token it carries.
//
// A previous revision carried a second row that drove the
// ?break=no-autocomplete rig and asserted "every autocomplete token
// is dropped" while positive-anchoring to AC-25102-1. That row is
// removed: the shipped AC forbids the absence, so pass-on-absence
// under the positive anchor was a de-claim violation. The negative
// rig still exists in the fixture for anatomy-test coverage of the
// break switches; it is not evidence for AC-25102-1.

import { fixtureFetch, startFixture, excerpt } from './probe-utils.mjs';

export const anchorAcId = 'application-account-settings-AC-25102-1';
export const accountBound = false;

const FIRST_EIGHT = 'GET /account/profile renders a <form data-surface="profile"> with inputs';

const REQUIRED = [
  { field: 'name', autocomplete: 'name' },
  { field: 'email', autocomplete: 'email' },
  { field: 'bday', autocomplete: 'bday' },
  { field: 'country', autocomplete: 'country' },
];

function inputAutocompletes(body) {
  const results = {};
  for (const m of body.matchAll(/<input[^>]*name="([^"]+)"[^>]*>/g)) {
    const attrs = m[0];
    const autoMatch = attrs.match(/autocomplete="([^"]+)"/);
    results[m[1]] = autoMatch ? autoMatch[1] : null;
  }
  return results;
}

export default async function runProbe() {
  const fixture = await startFixture();
  const results = [];
  try {
    const r = await fixtureFetch(fixture.url, '/account/profile');
    const surfacePresent = /<form data-surface="profile"/.test(r.body);
    const autos = inputAutocompletes(r.body);
    const missing = REQUIRED.filter((req) => autos[req.field] !== req.autocomplete);
    const pass = r.status === 200 && !!r.requestId && surfacePresent && missing.length === 0;
    results.push({
      anchorAcId,
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `${FIRST_EIGHT} carrying autocomplete tokens name/email/bday/country: the profile form renders and every required input carries the AC-25102-1 token verbatim; derived autocompletes=${JSON.stringify(autos)}; x-fixture-request-id=${r.requestId}`
        : `${FIRST_EIGHT} autocomplete gap: status=${r.status} rid=${r.requestId} surface=${surfacePresent} autos=${JSON.stringify(autos)} missing=${JSON.stringify(missing)}`,
      evidence: {
        requestId: r.requestId,
        responseStatus: r.status,
        bodyExcerpt: excerpt((r.body.match(/<form data-surface="profile"[^]{0,240}/) || [''])[0]),
        derived: { autos, missing, surfacePresent },
      },
    });
  } finally {
    await fixture.kill();
  }
  return { results };
}
