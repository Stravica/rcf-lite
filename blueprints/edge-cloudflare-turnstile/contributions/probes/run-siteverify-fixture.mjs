import runProbe from './siteverify-fixture.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'live-endpoint', image: 'Cloudflare siteverify endpoint challenges.cloudflare.com/turnstile/v0/siteverify via probe-pack-edge-cloudflare-turnstile fixture', healthy: true };
runShim('siteverify-fixture', engine, runProbe);
