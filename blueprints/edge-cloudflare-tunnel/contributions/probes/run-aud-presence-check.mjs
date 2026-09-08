import runProbe from './aud-presence-check.mjs';
import { runShim } from './probe-utils.mjs';
const engine = { kind: 'sidecar-read', image: 'edge-cloudflare-tunnel aud-presence facade', healthy: true };
runShim('aud-presence-check', engine, runProbe);
