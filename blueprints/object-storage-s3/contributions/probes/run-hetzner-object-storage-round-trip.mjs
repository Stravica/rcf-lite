/**
 * Shim: run hetzner-object-storage-round-trip. Without the account
 * gate the engine descriptor is `observed: false` naming the missing
 * gate; a live run would carry a real request id + http status on the
 * engine, but a real Hetzner branch is not exercised here (the probe
 * account-bound-skips honestly).
 */
import runProbe from './hetzner-object-storage-round-trip.mjs';
import { runShim } from './probe-utils.mjs';

const engine = process.env.CI_HAS_HETZNER_OBJECT_STORAGE === 'true'
  ? { kind: 's3', vendor: 'hetzner-object-storage', observed: false, note: 'live run recorded per-request on the probe result rows' }
  : { kind: 's3', vendor: 'hetzner-object-storage', observed: false, reason: 'CI_HAS_HETZNER_OBJECT_STORAGE unset' };
runShim('hetzner-object-storage-round-trip', engine, runProbe);
