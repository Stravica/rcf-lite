// Probe: caddyfile-validate (v1.1.8).
//
// This is an offline validator: it reads the shipped Caddyfile and
// the shipped compose.yaml and shells out to `caddy validate` (or
// a caddy:2 container via `docker run --rm`). It has no engine-
// minted identifier - the sha256 of the read artefact is computed
// by this probe with Node's `createHash` and the compose bind-
// mount line is text the probe extracted. Every result row is a
// `conformanceOnly` de-claim naming the shipped AC clause the
// offline check does not observe. The exit status, tail excerpt,
// the observed bind-mount line and the hash of the read artefact
// stay on the row as derived context.
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

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export const anchorAcId = null;
export const accountBound = false;

const VENDOR_CADDY = 'https://caddyserver.com/docs/command-line#caddy-validate';
const VENDOR_DOCKER = 'https://docs.docker.com/reference/cli/docker/container/run/';
const VENDOR_VERIFIED_ON = '2026-09-11';

const LIMIT_38107_4 = 'AC-38107-4: compose bind-mount for the reverse-proxy config is validated offline against the shipped compose.yaml text; the live on-server observation (the compose stack applying the read-only mount) is carried by real-account-minimal-stack-up.';
const LIMIT_REV_PROXY = 'AC-composeHost-reverseProxyArtefactValid: the reverse-proxy artefact is validated offline by `caddy validate` against the shipped Caddyfile; the live observation (the artefact serving traffic on the applied stack) is carried by real-account-reload-burst.';

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
      anchorAcId: null,
      conformanceOnly: true,
      limitation: LIMIT_REV_PROXY,
      verdict: 'skipped',
      detail: `offline caddyfile-validate: reverseProxy=${extra.reverseProxy}: skipped (applies only when reverseProxy=caddy)`,
      evidence: { reverseProxy: extra.reverseProxy },
    });
    return { results, extra };
  }

  // Bind-mount check: the compose file mounts caddy/Caddyfile
  // read-only into the caddy service. AC-38107-4 requires the :ro
  // suffix or read_only: true on the long-form. This is a source-
  // tree observation carried as a conformanceOnly de-claim.
  try {
    const composeText = await readFile(COMPOSE_PATH, 'utf8');
    const composeSha256 = sha256(composeText);
    const caddyMountRe = /\.\/caddy\/Caddyfile:\/etc\/caddy\/Caddyfile:ro/;
    if (caddyMountRe.test(composeText)) {
      results.push({
        anchorAcId: null,
        conformanceOnly: true,
        limitation: LIMIT_38107_4,
        verdict: 'pass',
        detail: 'offline caddyfile-validate: compose.yaml bind-mounts caddy/Caddyfile into the caddy service read-only (:ro suffix present)',
        evidence: {
          composeSha256,
          composeMountLine: (composeText.match(/[^\n]*Caddyfile:\/etc\/caddy\/Caddyfile[^\n]*/) || [''])[0],
          mountSuffix: ':ro',
        },
      });
    } else {
      results.push({
        anchorAcId: null,
        conformanceOnly: true,
        limitation: LIMIT_38107_4,
        verdict: 'fail',
        detail: 'offline caddyfile-validate: compose.yaml Caddyfile bind-mount is not read-only; expected :ro suffix on ./caddy/Caddyfile:/etc/caddy/Caddyfile',
        evidence: {
          composeSha256,
          composeMountLine: (composeText.match(/[^\n]*Caddyfile[^\n]*/) || [''])[0],
        },
      });
    }
  } catch (err) {
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: LIMIT_38107_4,
      verdict: 'fail',
      detail: `offline caddyfile-validate: could not read compose.yaml to check the Caddyfile bind-mount: ${err.message}`,
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
        anchorAcId: null,
        conformanceOnly: true,
        limitation: LIMIT_REV_PROXY,
        verdict: 'warn',
        detail: 'offline caddyfile-validate: neither caddy binary nor docker on PATH; caddy validate could not be exercised',
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
        anchorAcId: null,
        conformanceOnly: true,
        limitation: LIMIT_REV_PROXY,
        verdict: 'pass',
        detail: `offline caddyfile-validate: caddy validate exit 0 (${engineLabel}); tail: ${tail.slice(-200)}`,
        evidence: {
          caddyfileSha256,
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
        anchorAcId: null,
        conformanceOnly: true,
        limitation: LIMIT_REV_PROXY,
        verdict: 'fail',
        detail: `offline caddyfile-validate: caddy validate exit ${r.status} (${engineLabel}); tail: ${tail.slice(-400)}`,
        evidence: {
          caddyfileSha256,
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
