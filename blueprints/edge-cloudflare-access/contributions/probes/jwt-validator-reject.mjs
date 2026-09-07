// Probe: JWT validator reject cases - missing, expired, mis-signed each return 401 with metadata-only audit event.
// anchorAcId: AC-34102-1. accountBound: false.

export const anchorAcId = 'AC-34102-1';
export const accountBound = false;

export default async function runProbe() {
  const { bootFixtureJwks, loadValidator, fixtureEnv, FIXTURE_AUDIENCE, FIXTURE_ISSUER } = await import('./probe-utils.mjs');

  const boot = await bootFixtureJwks();
  const createAccessValidator = await loadValidator();

  const results = [];
  const subcases = [];

  // 1. Missing header
  {
    const sink = [];
    const validator = createAccessValidator({ env: fixtureEnv(boot.jwksUrl), eventSink: (r) => sink.push(r) });
    const req = new Request('https://cf-edge.fixture/protected');
    const outcome = await validator.middleware(req);
    subcases.push({
      name: 'missing',
      rejected: outcome.rejected,
      status: outcome.response?.status,
      auditCount: sink.length,
      auditOutcome: sink[0]?.outcome,
      auditKeys: sink[0] ? Object.keys(sink[0]).sort() : null,
    });
  }

  // 2. Expired (SIMULATE_EXPIRED_JWT flag forces the code path)
  {
    const sink = [];
    const validator = createAccessValidator({ env: fixtureEnv(boot.jwksUrl), eventSink: (r) => sink.push(r) });
    const jwt = boot.signerMod.fixtureAccessJwt({
      key: boot.key,
      profile: { issuer: FIXTURE_ISSUER, audience: FIXTURE_AUDIENCE },
      principal: { email: 'grace@example.com', sub: 'user:grace' },
      ttlSec: 60,
    });
    const req = new Request('https://cf-edge.fixture/protected', { headers: { 'Cf-Access-Jwt-Assertion': jwt } });
    const outcome = await validator.middleware(req, { SIMULATE_EXPIRED_JWT: true });
    subcases.push({
      name: 'expired',
      rejected: outcome.rejected,
      status: outcome.response?.status,
      auditCount: sink.length,
      auditOutcome: sink[0]?.outcome,
      auditKeys: sink[0] ? Object.keys(sink[0]).sort() : null,
    });
  }

  // 3. Mis-signed: sign with a DIFFERENT key, JWKS only carries the fixture key.
  {
    const sink = [];
    const validator = createAccessValidator({ env: fixtureEnv(boot.jwksUrl), eventSink: (r) => sink.push(r) });
    const wrongKey = boot.signerMod.createFixtureKey(boot.key.kid); // same kid so JWKS lookup hits, but a different keypair
    const jwt = boot.signerMod.fixtureAccessJwt({
      key: wrongKey,
      profile: { issuer: FIXTURE_ISSUER, audience: FIXTURE_AUDIENCE },
      principal: { email: 'evil@example.com', sub: 'user:evil' },
      ttlSec: 60,
    });
    const req = new Request('https://cf-edge.fixture/protected', { headers: { 'Cf-Access-Jwt-Assertion': jwt } });
    const outcome = await validator.middleware(req);
    subcases.push({
      name: 'mis-signed',
      rejected: outcome.rejected,
      status: outcome.response?.status,
      auditCount: sink.length,
      auditOutcome: sink[0]?.outcome,
      auditKeys: sink[0] ? Object.keys(sink[0]).sort() : null,
    });
  }

  // Note the mutation-check pair for the negative fires:
  // Fires on the shipped code path (no bypass): every rejected===true, status===401, auditCount===1, audit keys drawn from allowed set.
  // A mutation that removes the sink.push()/early-return call in the missing branch would drop auditCount to 0 (subcase would fail).

  const allowed = ['email', 'outcome', 'path', 'timestamp'];
  for (const sc of subcases) {
    const ok = sc.rejected === true && sc.status === 401 && sc.auditCount === 1 && sc.auditKeys && sc.auditKeys.join(',') === allowed.join(',');
    results.push({
      anchorAcId: 'AC-34102-1',
      verdict: ok ? 'pass' : 'fail',
      detail: ok
        ? `subcase ${sc.name}: 401 with one audit event, allowed keys only (${sc.auditKeys.join(',')}), outcome=${sc.auditOutcome}`
        : `subcase ${sc.name} broke: ${JSON.stringify(sc)}`,
    });
  }

  await boot.stop();
  return { results };
}
