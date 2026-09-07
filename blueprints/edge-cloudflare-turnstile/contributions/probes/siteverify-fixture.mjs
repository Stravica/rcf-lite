// Probe: server-side siteverify with pinned always-pass secret returns success:true;
// with pinned always-fail secret returns success:false. anchorAcId: AC-35102-1. accountBound: false.
// Drives the LIVE Cloudflare siteverify endpoint per spec section 3.1 (real-engine rule)
// with the public test keys documented at
// https://developers.cloudflare.com/turnstile/troubleshooting/testing/.

export const anchorAcId = 'AC-35102-1';
export const accountBound = false;

export default async function runProbe() {
  const { TEST_SECRETS, SITEVERIFY_URL, bootFixture, fixturePost, TEST_SITEKEYS } = await import('./probe-utils.mjs');
  const results = [];

  // Pass branch: drive siteverify with always-pass secret via the shipped verifier
  const passFixture = await bootFixture({ TURNSTILE_SECRET: TEST_SECRETS.alwaysPass, TURNSTILE_SITEKEY: TEST_SITEKEYS.alwaysPass });
  try {
    const passResp = await fixturePost(passFixture.url, '/api/submit', {
      email: 'reviewer@example.com',
      'turnstile-sitekey': TEST_SITEKEYS.alwaysPass,
      'cf-turnstile-response': 'XXXX.DUMMY.TOKEN.XXXX',
    });
    const okPass = passResp.status === 200 && passResp.json && passResp.json.received === 'ok';
    results.push({
      anchorAcId: 'AC-35102-1',
      verdict: okPass ? 'pass' : 'fail',
      detail: okPass
        ? `siteverify pass via ${SITEVERIFY_URL} with always-pass secret returned success:true; fixture /api/submit responded status=200 body=${JSON.stringify(passResp.json)}`
        : `siteverify pass unexpected shape status=${passResp.status} body=${passResp.text}`,
    });
  } finally { await passFixture.stop(); }

  // Fail branch: drive siteverify with always-fail secret; handler must reject with 400 and errorCodes
  const failFixture = await bootFixture({ TURNSTILE_SECRET: TEST_SECRETS.alwaysFail, TURNSTILE_SITEKEY: TEST_SITEKEYS.alwaysBlock });
  try {
    const failResp = await fixturePost(failFixture.url, '/api/submit', {
      email: 'reviewer@example.com',
      'turnstile-sitekey': TEST_SITEKEYS.alwaysBlock,
      'cf-turnstile-response': 'XXXX.DUMMY.TOKEN.XXXX',
    });
    const errorCodes = failResp.json && failResp.json.errorCodes;
    const codesOk = Array.isArray(errorCodes) && errorCodes.length > 0;
    const okFail = failResp.status === 400 && failResp.json && failResp.json.errorCode === 'turnstile.siteverify-failed' && codesOk;
    results.push({
      anchorAcId: 'AC-35102-1',
      verdict: okFail ? 'pass' : 'fail',
      detail: okFail
        ? `siteverify fail via ${SITEVERIFY_URL} with always-fail secret returned success:false; fixture /api/submit responded status=400 errorCode=turnstile.siteverify-failed errorCodes=${JSON.stringify(errorCodes)}`
        : `siteverify fail unexpected shape status=${failResp.status} body=${failResp.text}`,
    });
  } finally { await failFixture.stop(); }

  return { results };
}
