import runProbe from './real-account-gated-url.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'real-account', image: 'live fetch against Cloudflare Access-configured hostname', healthy: true };
runShim('real-account-gated-url', engine, runProbe);
