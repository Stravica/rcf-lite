import runProbe from './real-account-burst-and-429.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'real-account', image: 'undici burst against scheduled Cloudflare-fronted URL', healthy: true };
runShim('real-account-burst-and-429', engine, runProbe);
