import runProbe from './event-secrecy.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'event-sink-accumulation', image: 'cf-edge fixture drift-audit runner driven with synthetic manifest and fake fetch (in-process)', healthy: true };
runShim('event-secrecy', engine, runProbe);
