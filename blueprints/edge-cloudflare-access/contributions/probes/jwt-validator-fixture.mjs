// Probe: JWT validator - fixture-signed JWT validates and principal reduces onto request.auth.
// anchorAcId: AC-34101-1. accountBound: false.

export const anchorAcId = 'AC-34101-1';
export const accountBound = false;

export default async function runProbe() {
  const { bootFixtureJwks, loadValidator, fixtureEnv, FIXTURE_AUDIENCE, FIXTURE_ISSUER } = await import('./probe-utils.mjs');

  const boot = await bootFixtureJwks();
  const createAccessValidator = await loadValidator();

  const sink = [];
  const validator = createAccessValidator({ env: fixtureEnv(boot.jwksUrl), eventSink: (r) => sink.push(r) });

  const jwt = boot.signerMod.fixtureAccessJwt({
    key: boot.key,
    profile: { issuer: FIXTURE_ISSUER, audience: FIXTURE_AUDIENCE },
    principal: { email: 'ada@example.com', sub: 'user:ada', groups: ['admins', 'shipping'] },
    ttlSec: 60,
  });

  const req = new Request('https://cf-edge.fixture/protected', {
    headers: { 'Cf-Access-Jwt-Assertion': jwt },
  });
  const outcome = await validator.middleware(req);
  const results = [];

  const principal = outcome.outcome?.principal;
  const okShape =
    outcome.rejected === false &&
    principal &&
    principal.email === 'ada@example.com' &&
    principal.sub === 'user:ada' &&
    Array.isArray(principal.groups) &&
    principal.groups.length === 2 &&
    req.auth &&
    req.auth.email === 'ada@example.com';

  results.push({
    anchorAcId: 'AC-34101-1',
    verdict: okShape ? 'pass' : 'fail',
    detail: okShape
      ? `validator resolved; principal reduces to {email:${principal.email}, sub:${principal.sub}, groups:${JSON.stringify(principal.groups)}}; request.auth attached; audit outcome=validated`
      : `validator did not resolve as expected; outcome=${JSON.stringify(outcome)} request.auth=${JSON.stringify(req.auth ?? null)}`,
  });

  // Audit sink should hold one record, allowed keys only, outcome=validated.
  const record = sink[sink.length - 1];
  const allowed = new Set(['email', 'outcome', 'timestamp', 'path']);
  const extraKeys = record ? Object.keys(record).filter((k) => !allowed.has(k)) : ['(no record)'];
  const auditOk = sink.length === 1 && record && record.outcome === 'validated' && record.email === 'ada@example.com' && record.path === '/protected' && extraKeys.length === 0;
  results.push({
    anchorAcId: 'AC-34101-1',
    verdict: auditOk ? 'pass' : 'fail',
    detail: auditOk
      ? `one audit record with allowed keys only; outcome=validated email=${record.email} path=${record.path}`
      : `unexpected audit shape; count=${sink.length} record=${JSON.stringify(record ?? null)} extraKeys=${JSON.stringify(extraKeys)}`,
  });

  await boot.stop();
  return { results };
}
