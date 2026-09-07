// Probe: audit event secrecy - 10 records after 5 pass + 5 reject, no forbidden substrings.
// anchorAcId: AC-34106-1. accountBound: false.

export const anchorAcId = 'AC-34106-1';
export const accountBound = false;

export default async function runProbe() {
  const { bootFixtureJwks, loadValidator, fixtureEnv, FIXTURE_AUDIENCE, FIXTURE_ISSUER } = await import('./probe-utils.mjs');

  const boot = await bootFixtureJwks();
  const createAccessValidator = await loadValidator();

  const sink = [];
  const validator = createAccessValidator({ env: fixtureEnv(boot.jwksUrl), eventSink: (r) => sink.push(r) });

  const tokens = [];
  // 5 pass runs
  for (let i = 0; i < 5; i++) {
    const jwt = boot.signerMod.fixtureAccessJwt({
      key: boot.key,
      profile: { issuer: FIXTURE_ISSUER, audience: FIXTURE_AUDIENCE },
      principal: { email: `user${i}@example.com`, sub: `user:u${i}`, groups: ['members'] },
      ttlSec: 60,
    });
    tokens.push(jwt);
    const req = new Request(`https://cf-edge.fixture/pass/${i}`, { headers: { 'Cf-Access-Jwt-Assertion': jwt } });
    await validator.middleware(req);
  }
  // 5 reject runs (missing header)
  for (let i = 0; i < 5; i++) {
    const req = new Request(`https://cf-edge.fixture/reject/${i}`);
    await validator.middleware(req);
  }

  const results = [];
  const allowed = ['email', 'outcome', 'path', 'timestamp'];
  const shapeOk = sink.length === 10 && sink.every((r) => Object.keys(r).sort().join(',') === allowed.join(','));
  results.push({
    anchorAcId: 'AC-34106-1',
    verdict: shapeOk ? 'pass' : 'fail',
    detail: shapeOk
      ? `10 audit records, allowed keys only (${allowed.join(',')})`
      : `unexpected sink shape; count=${sink.length} sample=${JSON.stringify(sink[0] ?? null)}`,
  });

  // No forbidden substrings across the serialised sink.
  const serialised = JSON.stringify(sink);
  const forbidden = [];
  for (const jwt of tokens) {
    const parts = jwt.split('.');
    // Include full JWT, header segment, payload segment and signature segment individually.
    for (const seg of [jwt, parts[0], parts[1], parts[2]]) {
      if (seg && serialised.includes(seg)) forbidden.push(`token-segment len=${seg.length}`);
    }
  }
  for (const header of ['Cf-Access-Jwt-Assertion', 'Authorization', 'CF-Access-Client-Id', 'CF-Access-Client-Secret']) {
    if (serialised.includes(header)) forbidden.push(`header-name ${header}`);
  }
  const secrecyOk = forbidden.length === 0;
  results.push({
    anchorAcId: 'AC-34106-1',
    verdict: secrecyOk ? 'pass' : 'fail',
    detail: secrecyOk
      ? `no forbidden substrings in the serialised sink; ran 5 pass + 5 reject; sink JSON bytes=${serialised.length}`
      : `forbidden substrings found: ${JSON.stringify(forbidden)}`,
  });

  await boot.stop();
  return { results };
}
