import runProbe from './kubernetes-startup-enabled.mjs';
import { runShim } from './probe-utils.mjs';
runShim('kubernetes-startup-enabled', { kind: 'http', driver: 'node:http fixture profile registry on 127.0.0.1', healthy: true }, runProbe);
