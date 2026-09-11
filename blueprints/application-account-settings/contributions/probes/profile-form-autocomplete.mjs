// application-account-settings probe: profile form autocomplete
// tokens (AC-25102-1). AC-25102-1 requires <form data-surface="profile">
// with inputs carrying autocomplete tokens "name", "email", "bday",
// and "country". Derived observation: parse the form's input elements
// and match each required field to the autocomplete token it carries.

import { fixtureFetch, startFixture, excerpt } from './probe-utils.mjs';

export const anchorAcId = 'application-account-settings-AC-25102-1';
export const accountBound = false;

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
        ? `GET /account/profile: <form data-surface="profile"> present; every required input carries the AC-25102-1 autocomplete token (name/email/bday/country); derived: ${JSON.stringify(autos)}; x-fixture-request-id=${r.requestId}`
        : `profile autocomplete evidence gap: status=${r.status} rid=${r.requestId} surface=${surfacePresent} autos=${JSON.stringify(autos)} missing=${JSON.stringify(missing)}`,
      evidence: {
        requestId: r.requestId,
        responseStatus: r.status,
        bodyExcerpt: excerpt((r.body.match(/<form data-surface="profile"[^]{0,240}/) || [''])[0]),
        derived: { autos, missing },
      },
    });

    const broken = await fixtureFetch(fixture.url, '/account/profile?break=no-autocomplete');
    const brokenAutos = inputAutocompletes(broken.body);
    const noneAuto = Object.values(brokenAutos).every((v) => v === null);
    const varyPass = broken.status === 200 && !!broken.requestId && noneAuto;
    results.push({
      anchorAcId,
      verdict: varyPass ? 'pass' : 'fail',
      detail: varyPass
        ? `GET /account/profile?break=no-autocomplete returns 200 with every input's autocomplete token dropped; derived: ${JSON.stringify(brokenAutos)}; the AC-25102-1 check would refuse; x-fixture-request-id=${broken.requestId}`
        : `break=no-autocomplete gap: status=${broken.status} rid=${broken.requestId} autos=${JSON.stringify(brokenAutos)}`,
      evidence: {
        requestId: broken.requestId,
        responseStatus: broken.status,
        bodyExcerpt: excerpt((broken.body.match(/<form data-surface="profile"[^]{0,240}/) || [''])[0]),
        derived: { brokenAutos },
      },
    });
  } finally {
    await fixture.kill();
  }
  return { results };
}
