// Probe: cloudflared-config-lint.
//
// anchorAcId list: AC-tunnel-hostnameRoutes (primary).
// accountBound: false.
//
// Verdict is a pure function of the files at fixtureRoot(). The probe:
// 1. Locates cloudflared (local binary on PATH first, else the vendor
//    container image cloudflare/cloudflared:2026.8.3 via docker run --rm).
// 2. Runs `cloudflared tunnel ingress validate --config /etc/cloudflared/<mode>.yaml`
//    against each fixture (compose-service and systemd-unit, both public-
//    hostname and access-gated modes); asserts exit 0 on the canonical fixture.
// 3. When neither cloudflared nor docker is available, records warn (the
//    schema-validate probe still surfaces the source-tree shape).

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  runShim, fixtureRoot, pairs, whichDocker, whichCloudflared, CLOUDFLARED_IMAGE,
} from './probe-utils.mjs';

export const anchorAcIds = ['AC-tunnel-hostnameRoutes'];
export const accountBound = false;

function runCloudflaredLint({ manifestDir, manifestName, useDocker, cloudflaredVersion }) {
  if (!useDocker) {
    const r = spawnSync('cloudflared', ['tunnel', '--config', resolve(manifestDir, manifestName), 'ingress', 'validate'], {
      encoding: 'utf8', timeout: 60_000,
    });
    return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', engine: `cloudflared ${cloudflaredVersion}` };
  }
  const r = spawnSync('docker', [
    'run', '--rm', '-v', `${manifestDir}:/etc/cloudflared:ro`,
    CLOUDFLARED_IMAGE, 'tunnel', '--config', `/etc/cloudflared/${manifestName}`, 'ingress', 'validate',
  ], { encoding: 'utf8', timeout: 120_000 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', engine: `docker ${CLOUDFLARED_IMAGE}` };
}

export default async function runProbe() {
  const results = [];
  const extra = { fixtureRoot: fixtureRoot() };
  const cloudflared = whichCloudflared();
  const docker = whichDocker();
  extra.cloudflaredVersion = cloudflared;
  extra.dockerVersion = docker;
  if (!cloudflared && !docker) {
    results.push({
      anchorAcId: 'AC-tunnel-hostnameRoutes',
      verdict: 'warn',
      detail: 'Neither a local cloudflared binary nor docker is available on PATH; cloudflared tunnel ingress validate was not exercised. Install cloudflared or docker to exercise the lint.',
    });
    return { results, extra };
  }
  const useDocker = !cloudflared;
  for (const { runtime, mode } of pairs()) {
    const manifestDir = resolve(fixtureRoot(), runtime, 'cloudflare/tunnels');
    const manifestName = `${mode}.yaml`;
    const r = runCloudflaredLint({ manifestDir, manifestName, useDocker, cloudflaredVersion: cloudflared });
    if (r.status === 0) {
      results.push({
        anchorAcId: 'AC-tunnel-hostnameRoutes',
        verdict: 'pass',
        detail: `${runtime}/${mode}: cloudflared tunnel ingress validate exit 0 (${r.engine})`,
      });
    } else {
      const tail = (r.stderr || r.stdout || '').split('\n').slice(-8).join(' | ').slice(0, 800);
      results.push({
        anchorAcId: 'AC-tunnel-hostnameRoutes',
        verdict: 'fail',
        detail: `${runtime}/${mode}: cloudflared tunnel ingress validate exit ${r.status} (${r.engine}): ${tail}`,
      });
    }
    extra[`${runtime}/${mode}`] = { exit: r.status };
  }
  return { results, extra };
}

const engine = { kind: 'cloudflared-ingress-validate', image: CLOUDFLARED_IMAGE, healthy: true };
if (import.meta.url === `file://${process.argv[1]}`) {
  await runShim('cloudflared-config-lint', engine, runProbe);
}
