import runProbe from './event-secrecy.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'in-process', image: 'in-process dispatcher on cf-platform fixture with PII closure', healthy: true };
runShim('event-secrecy', engine, runProbe);
