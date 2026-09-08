import runProbe from './cloudflared-config-lint.mjs';
import { runShim, CLOUDFLARED_IMAGE } from './probe-utils.mjs';
const engine = { kind: 'cloudflared-ingress-validate', image: CLOUDFLARED_IMAGE, healthy: true };
runShim('cloudflared-config-lint', engine, runProbe);
