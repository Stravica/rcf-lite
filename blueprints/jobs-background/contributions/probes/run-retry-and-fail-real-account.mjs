/**
 * Shim: run retry-and-fail-real-account against the Stravica QA
 * Cloudflare account. Records real HTTP status + per-pull observations
 * as engine descriptor.
 */
import runProbe from './retry-and-fail-real-account.mjs';
import { runShim } from './probe-utils.mjs';

const engine = process.env.CI_HAS_CLOUDFLARE_ACCOUNT === 'true'
  ? { kind: 'queue', vendor: 'cloudflare-queues', observed: 'per-request on results' }
  : { kind: 'queue', vendor: 'cloudflare-queues', observed: false, reason: 'CI_HAS_CLOUDFLARE_ACCOUNT unset' };
runShim('retry-and-fail-real-account', engine, runProbe);
