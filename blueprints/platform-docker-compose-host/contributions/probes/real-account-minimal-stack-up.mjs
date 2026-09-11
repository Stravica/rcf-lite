// Probe: real-account-minimal-stack-up.
//
// anchorAcId: AC-composeHost-upClean.
// accountBound: true.
//
// On the shared throwaway-Hetzner-server fixture (spec 3.3): when
// CI_HAS_HETZNER_ACCOUNT is set, provisions a throwaway cx23 in fsn1,
// installs docker and docker compose over ssh, ships the fixture
// compose bundle to /home/deploy/stack, runs docker compose up -d
// --wait, then curls the caddy :80 /live endpoint from the local
// runner and records the response body plus statusCode as 7d positive
// evidence ("deployed stack URL that answers"). The throwaway server
// is destroyed in always() regardless of verdict.
//
// Without CI_HAS_HETZNER_ACCOUNT the probe records
// accountBoundSkipped: true (reason names the env var) and the
// aggregate flips to pass per the real-account gate contract,
// section 3.5.

import { resolve } from 'node:path';
import { runShim, accountBoundSkippedResult, FIXTURE_DIR } from './probe-utils.mjs';

export const anchorAcId = 'AC-composeHost-upClean';
export const accountBound = true;

export default async function runProbe() {
  if (process.env.CI_HAS_HETZNER_ACCOUNT !== 'true') {
    return {
      results: [accountBoundSkippedResult(anchorAcId, 'real-account minimal-stack-up skipped; run with CI_HAS_HETZNER_ACCOUNT=true to exercise the compose stack against a throwaway cx23.')],
      extra: { skipped: true, missingEnv: ['CI_HAS_HETZNER_ACCOUNT'] },
    };
  }
  const { provisionThrowawayServer } = await import(resolve(FIXTURE_DIR, 'provision.mjs'));
  const { destroyThrowawayServer } = await import(resolve(FIXTURE_DIR, 'destroy.mjs'));
  const { bringUpStack, httpProbe, tearDownStack } = await import(resolve(FIXTURE_DIR, 'src/compose-stack-driver.mjs'));

  let provisioned = null;
  try {
    provisioned = await provisionThrowawayServer({ runId: process.env.GITHUB_RUN_ID ?? `local-${Date.now()}` });
    const brought = await bringUpStack(provisioned);
    if (!brought.ok) {
      return {
        results: [{
          anchorAcId, verdict: 'fail',
          detail: `stack failed at phase ${brought.phase} on server ${provisioned.id}: ${JSON.stringify(brought).slice(0, 500)}`,
        }],
        extra: { serverId: provisioned.id, brought },
      };
    }
    const url = `http://${provisioned.primaryIpv4}/live`;
    const http = await httpProbe(url);
    const rootUrl = `http://${provisioned.primaryIpv4}/`;
    const httpRoot = await httpProbe(rootUrl);
    if (!http.ok || http.statusCode !== 200) {
      return {
        results: [{
          anchorAcId, verdict: 'fail',
          detail: `caddy /live did not return 2xx on ${url}: statusCode=${http.statusCode} error=${http.error || 'none'} bodyExcerpt=${http.bodyExcerpt || ''}`,
        }],
        extra: { serverId: provisioned.id, url, http, brought },
      };
    }
    return {
      results: [{
        anchorAcId, verdict: 'pass',
        detail: `stack up on server ${provisioned.id} (${provisioned.primaryIpv4}); ${brought.services.length} services declared; caddy answered ${url} with ${http.statusCode} body="${http.bodyExcerpt.replace(/\n/g, ' ')}"; root ${rootUrl} returned ${httpRoot.statusCode}.`,
      }],
      extra: {
        serverId: provisioned.id,
        primaryIpv4: provisioned.primaryIpv4,
        deployedStackUrl: url,
        http, httpRoot,
        services: brought.services,
        eventTrail: brought.events,
      },
    };
  } catch (err) {
    return {
      results: [{ anchorAcId, verdict: 'fail', detail: `minimal-stack-up threw: ${err.message}` }],
      extra: { serverId: provisioned && provisioned.id, error: err.stack || err.message },
    };
  } finally {
    if (provisioned && provisioned.id) {
      try { await tearDownStack(provisioned); } catch (_) { /* server destroy below still fires */ }
      try { await destroyThrowawayServer(provisioned); } catch (_) { /* swept by orphan cron */ }
    }
  }
}

const engine = { kind: 'throwaway-server', image: 'hetzner cx23 in fsn1 via provision.mjs', healthy: true };
if (import.meta.url === `file://${process.argv[1]}`) {
  await runShim('real-account-minimal-stack-up', engine, runProbe);
}
