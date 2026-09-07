import runProbe from './audit-event-secrecy.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'in-process', image: 'in-process JWT validator on cf-edge fixture', healthy: true };
runShim('audit-event-secrecy', engine, runProbe);
