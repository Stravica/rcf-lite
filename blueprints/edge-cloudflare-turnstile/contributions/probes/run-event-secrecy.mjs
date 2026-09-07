import runProbe from './event-secrecy.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'live-endpoint', image: 'Cloudflare siteverify endpoint via probe-pack-edge-cloudflare-turnstile fixture; event sink asserted for secrecy', healthy: true };
runShim('event-secrecy', engine, runProbe);
