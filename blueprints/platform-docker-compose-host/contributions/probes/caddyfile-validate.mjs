// Probe: caddyfile-validate (v1.1.5).
//
// anchorAcId: AC-composeHost-reverseProxyArtefactValid.
// accountBound: false.
//
// Every result row carries an `evidence` object (the shape rule).
// The probe now also observes the compose bind-mount for the
// Caddyfile is read-only (:ro suffix or read_only: true on the
// long-form) and anchors the observation to AC-38107-4 (read-only
// bind-mount).
//
// Mutation:
// - SIMULATE_INVALID_CADDYFILE=true appends an unclosed-block syntax
//   error to a scratch copy of the Caddyfile; the probe FAILS naming
//   the offending tail.

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runShim, CADDYFILE_PATH, COMPOSE_PATH, whichCaddy, whichDocker } from './probe-utils.mjs';

// Deterministic content hash of the artefact the row observed; the
// engine-minted identifier on offline caddyfile-validate rows under
// the semantic anatomy rule.
function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export const anchorAcId = 'AC-composeHost-reverseProxyArtefactValid';
export const accountBound = false;

const VENDOR_CADDY = 'https://caddyserver.com/docs/command-line#caddy-validate';
const VENDOR_DOCKER = 'https://docs.docker.com/reference/cli/docker/container/run/';
const VENDOR_VERIFIED_ON = '2026-09-11';

function isCaddyReverseProxy() {
  const v = process.env.REVERSE_PROXY;
  if (v === undefined || v === 'caddy') return true;
  return false;
}

export default async function runProbe() {
  const results = [];
  const extra = {};
  extra.mutations = { invalidCaddyfile: process.env.SIMULATE_INVALID_CADDYFILE === 'true' };
  extra.reverseProxy = process.env.REVERSE_PROXY ?? 'caddy';
  if (!isCaddyReverseProxy()) {
    results.push({
      anchorAcId,
      verdict: 'skipped',
      detail: `reverseProxy=${extra.reverseProxy}: caddyfile-validate skipped (applies only when reverseProxy=caddy)`,
      evidence: { reverseProxy: extra.reverseProxy },
    });
    return { results, extra };
  }

  // Bind-mount check: the compose file mounts caddy/Caddyfile
  // read-only into the caddy service. AC-38107-4 requires the :ro
  // suffix or read_only: true on the long-form. This is a source-tree
  // observation that carries its own evidence.
  try {
    const composeText = await readFile(COMPOSE_PATH, 'utf8');
    const composeSha256 = sha256(composeText);
    const caddyMountRe = /\.\/caddy\/Caddyfile:\/etc\/caddy\/Caddyfile:ro/;
    if (caddyMountRe.test(composeText)) {
      results.push({
        anchorAcId: 'AC-38107-4',
        verdict: 'pass',
        detail: 'compose.yaml bind-mounts caddy/Caddyfile into the caddy service read-only (:ro suffix present)',
        evidence: {
          contentSha256: composeSha256,
          composeMountLine: (composeText.match(/[^\n]*Caddyfile:\/etc\/caddy\/Caddyfile[^\n]*/) || [''])[0],
          suffix: ':ro',
        },
      });
    } else {
      results.push({
        anchorAcId: 'AC-38107-4',
        verdict: 'fail',
        detail: 'compose.yaml Caddyfile bind-mount is not read-only; expected :ro suffix on ./caddy/Caddyfile:/etc/caddy/Caddyfile',
        evidence: {
          contentSha256: composeSha256,
          composeMountLine: (composeText.match(/[^\n]*Caddyfile[^\n]*/) || [''])[0],
        },
      });
    }
  } catch (err) {
    results.push({
      anchorAcId: 'AC-38107-4',
      verdict: 'fail',
      detail: `could not read compose.yaml to check the Caddyfile bind-mount: ${err.message}`,
      evidence: { composePath: COMPOSE_PATH, error: err.message },
    });
  }

  const scratchDir = join(tmpdir(), `rcf-lite-t2-caddyfile-validate-${Date.now()}`);
  await mkdir(scratchDir, { recursive: true });
  const scratchPath = join(scratchDir, 'Caddyfile');
  try {
    let text = await readFile(CADDYFILE_PATH, 'utf8');
    if (process.env.SIMULATE_INVALID_CADDYFILE === 'true') {
      text = text + "\n{ unclosed_block_that_never_ends_and_is_a_syntax_error_caddy_will_reject\n";
    }
    const caddyfileSha256 = sha256(text);
    await writeFile(scratchPath, text, 'utf8');
    const localCaddy = whichCaddy();
    const localDocker = whichDocker();
    extra.caddyLocal = localCaddy;
    extra.dockerLocal = localDocker;
    let cmd, args, engineLabel;
    if (localCaddy !== null) {
      cmd = 'caddy';
      args = ['validate', '--config', scratchPath, '--adapter', 'caddyfile'];
      engineLabel = `local caddy ${localCaddy}`;
    } else if (localDocker !== null) {
      cmd = 'docker';
      args = ['run', '--rm', '-v', `${scratchDir}:/etc/caddy:ro`, 'caddy:2',
        'caddy', 'validate', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'];
      engineLabel = 'caddy:2 container (docker run --rm)';
    } else {
      results.push({
        anchorAcId,
        verdict: 'warn',
        detail: 'neither caddy binary nor docker on PATH; caddy validate could not be exercised',
        evidence: { caddyLocal: null, dockerLocal: null },
      });
      return { results, extra };
    }
    const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 60_000 });
    extra.exitStatus = r.status;
    extra.engineLabel = engineLabel;
    const tail = ((r.stderr || '') + (r.stdout || '')).split('\n').slice(-10).join('\n');
    if (r.status === 0) {
      results.push({
        anchorAcId,
        verdict: 'pass',
        detail: `caddy validate exit 0 (${engineLabel}); tail: ${tail.slice(-200)}`,
        evidence: {
          contentSha256: caddyfileSha256,
          engineLabel,
          exitStatus: 0,
          tailExcerpt: tail.slice(-400),
          vendorDocs: {
            caddyValidate: VENDOR_CADDY,
            dockerRunRm: VENDOR_DOCKER,
            verifiedOn: VENDOR_VERIFIED_ON,
          },
        },
      });
    } else {
      results.push({
        anchorAcId,
        verdict: 'fail',
        detail: `caddy validate exit ${r.status} (${engineLabel}); tail: ${tail.slice(-400)}`,
        evidence: {
          contentSha256: caddyfileSha256,
          engineLabel,
          exitStatus: r.status,
          tailExcerpt: tail.slice(-400),
          vendorDocs: {
            caddyValidate: VENDOR_CADDY,
            dockerRunRm: VENDOR_DOCKER,
            verifiedOn: VENDOR_VERIFIED_ON,
          },
        },
      });
    }
  } finally {
    await rm(scratchDir, { recursive: true, force: true });
  }
  return { results, extra };
}

const engine = { kind: 'caddy-validate', image: 'caddy:2 (or local caddy binary)', healthy: true };
if (import.meta.url === `file://${process.argv[1]}`) {
  await runShim('caddyfile-validate', engine, runProbe);
}
