// Probe: real-account-minimal-stack-up (v1.1.4 closure fix).
//
// anchorAcId: AC-composeHost-upClean.
// accountBound: true.
//
// Addendum-driven contract:
//   - First-tier gate CI_HAS_HETZNER_ACCOUNT must equal exactly the
//     string "true"; anything else records an honest skip row.
//   - Second-tier HCLOUD_TOKEN missing carries its own honest skip row.
//   - The pass row carries an `evidence` object with the created
//     server id, the compose ps service list, the on-server HTTP
//     response (statusCode and body excerpt) proving the deployed
//     stack URL answers, and the root-path body sample that reads the
//     mounted secret file (`tokenPresence`).
//   - Teardown failure FAILS the verdict (Addendum rule 5).

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import {
  runShim, firstTierGateSkipResult, secondTierMissingSkipResult, FIXTURE_DIR,
} from './probe-utils.mjs';

export const anchorAcId = 'AC-composeHost-upClean';
export const accountBound = true;

function hcloudJson(argv, { timeoutMs = 60_000 } = {}) {
  return new Promise((resolvePromise, reject) => {
    const p = spawn('hcloud', argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch (_) {} reject(new Error(`hcloud ${argv.join(' ')} timed out after ${timeoutMs}ms`)); }, timeoutMs);
    p.stdout.on('data', (d) => { stdout += d.toString(); });
    p.stderr.on('data', (d) => { stderr += d.toString(); });
    p.on('error', (err) => { clearTimeout(timer); reject(err); });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`hcloud ${argv.join(' ')} exited ${code}: ${stderr}`));
      const trimmed = stdout.trim();
      if (trimmed.length === 0) return resolvePromise([]);
      try {
        const parsed = JSON.parse(trimmed);
        resolvePromise(Array.isArray(parsed) ? parsed : (parsed.servers || []));
      } catch (err) {
        reject(new Error(`hcloud stdout not JSON: ${err.message}`));
      }
    });
  });
}

export default async function runProbe() {
  if (process.env.CI_HAS_HETZNER_ACCOUNT !== 'true') {
    return {
      results: [firstTierGateSkipResult(
        anchorAcId,
        'CI_HAS_HETZNER_ACCOUNT',
        'real-account minimal-stack-up skipped; run with CI_HAS_HETZNER_ACCOUNT=true to exercise the compose stack against a throwaway cx23.',
      )],
      extra: { skipped: true, missingEnv: ['CI_HAS_HETZNER_ACCOUNT'] },
    };
  }
  if (!process.env.HCLOUD_TOKEN) {
    return {
      results: [secondTierMissingSkipResult(
        anchorAcId,
        'HCLOUD_TOKEN',
        'the throwaway cx23 cannot be provisioned without HCLOUD_TOKEN.',
      )],
      extra: { skipped: true, missingEnv: ['HCLOUD_TOKEN'] },
    };
  }
  const { provisionThrowawayServer } = await import(resolve(FIXTURE_DIR, 'provision.mjs'));
  const { destroyThrowawayServer } = await import(resolve(FIXTURE_DIR, 'destroy.mjs'));
  const { bringUpStack, httpProbe, httpProbeOnServer, tearDownStack } = await import(resolve(FIXTURE_DIR, 'src/compose-stack-driver.mjs'));

  const evidence = {};
  const resultRow = { anchorAcId, verdict: 'fail', detail: '', evidence };
  let provisioned = null;
  try {
    provisioned = await provisionThrowawayServer({ runId: process.env.GITHUB_RUN_ID ?? `local-${Date.now()}` });
    evidence.serverId = provisioned.id;
    evidence.primaryIpv4 = provisioned.primaryIpv4;
    const brought = await bringUpStack(provisioned);
    evidence.services = brought.services;
    evidence.eventTrail = brought.events;
    if (!brought.ok) {
      resultRow.verdict = 'fail';
      resultRow.detail = `stack failed at phase ${brought.phase} on server ${provisioned.id}: ${JSON.stringify(brought).slice(0, 500)}`;
      return { results: [resultRow], extra: evidence };
    }
    const onServer = await httpProbeOnServer(provisioned, '/live');
    const onServerRoot = await httpProbeOnServer(provisioned, '/');
    const externalUrl = `http://${provisioned.primaryIpv4}/live`;
    const external = await httpProbe(externalUrl, { timeoutMs: 5000 });
    evidence.onServer = {
      target: onServer.target, statusCode: onServer.statusCode,
      bodyExcerpt: onServer.bodyExcerpt, elapsedSeconds: onServer.elapsedSeconds,
      requestId: onServer.requestId,
    };
    evidence.onServerRoot = {
      target: onServerRoot.target, statusCode: onServerRoot.statusCode,
      bodyExcerpt: onServerRoot.bodyExcerpt,
    };
    evidence.external = {
      url: externalUrl, statusCode: external.statusCode, error: external.error || null,
      note: 'off-host fetch expected to fail under the deploy-hetzner-server DOCKER-USER hardening',
    };
    if (!onServer.ok || onServer.statusCode !== 200) {
      resultRow.verdict = 'fail';
      resultRow.detail = `caddy /live did not return 200 on ${onServer.target}: statusCode=${onServer.statusCode} error=${onServer.error || 'none'} bodyExcerpt=${onServer.bodyExcerpt || ''}`;
      return { results: [resultRow], extra: evidence };
    }
    resultRow.verdict = 'pass';
    resultRow.detail = `stack up on server ${provisioned.id} (${provisioned.primaryIpv4}); ${brought.services.length} services declared; caddy answered ${onServer.target} with ${onServer.statusCode} body="${(onServer.bodyExcerpt || '').replace(/\n/g, ' ')}" elapsed=${onServer.elapsedSeconds}s; root ${onServerRoot.target} returned ${onServerRoot.statusCode}.`;
  } catch (err) {
    resultRow.verdict = 'fail';
    resultRow.detail = `minimal-stack-up threw: ${err.message}`;
    evidence.error = err.stack || err.message;
    return { results: [resultRow], extra: evidence };
  } finally {
    if (provisioned && provisioned.id) {
      let tearDownDown = null;
      try {
        tearDownDown = await tearDownStack(provisioned);
        evidence.composeDown = { code: tearDownDown && tearDownDown.code, stderrExcerpt: (tearDownDown && tearDownDown.stderr || '').slice(0, 300) };
        if (tearDownDown && tearDownDown.code !== 0) {
          resultRow.verdict = 'fail';
          resultRow.detail = `${resultRow.detail} TEARDOWN docker compose down exited ${tearDownDown.code}: ${(tearDownDown.stderr || '').slice(0, 300)}`;
        }
      } catch (err) {
        resultRow.verdict = 'fail';
        resultRow.detail = `${resultRow.detail} TEARDOWN docker compose down failed: ${err.message}`;
        evidence.composeDownError = err.message;
      }
      try {
        await destroyThrowawayServer(provisioned);
        evidence.teardown = { destroyed: provisioned.id };
        try {
          const postList = await hcloudJson(['server', 'list', '--output', 'json']);
          evidence.postTeardownServerIds = postList.map((s) => s.id);
          if (postList.some((s) => s.id === provisioned.id)) {
            resultRow.verdict = 'fail';
            resultRow.detail = `${resultRow.detail} TEARDOWN INCOMPLETE: server ${provisioned.id} still present in hcloud server list.`;
          }
        } catch (err) {
          evidence.postTeardownListError = err.message;
        }
      } catch (err) {
        resultRow.verdict = 'fail';
        resultRow.detail = `${resultRow.detail} TEARDOWN FAILED for server ${provisioned.id}: ${err.message}.`;
        evidence.teardownError = err.message;
        evidence.orphanServerId = provisioned.id;
      }
    }
  }
  return { results: [resultRow], extra: evidence };
}

const engine = { kind: 'throwaway-server', image: 'hetzner cx23 in fsn1 via provision.mjs', healthy: true };
if (import.meta.url === `file://${process.argv[1]}`) {
  await runShim('real-account-minimal-stack-up', engine, runProbe);
}
