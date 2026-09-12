/**
 * Shim: run r2-real-account-smoke. The engine descriptor carries a
 * real observation (an S3 ListBuckets against the R2 endpoint from
 * the fixture secrets shim, returning a real requestId + httpStatus)
 * when the account gate is set, otherwise a not-observed descriptor
 * that names the missing gate.
 */
import runProbe from './r2-real-account-smoke.mjs';
import { runShim, observeR2Engine } from './probe-utils.mjs';

const engine = await observeR2Engine();
runShim('r2-real-account-smoke', engine, runProbe);
