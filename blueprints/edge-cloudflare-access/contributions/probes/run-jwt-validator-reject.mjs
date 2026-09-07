import runProbe from './jwt-validator-reject.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'in-process', image: 'in-process JWT validator on cf-edge fixture', healthy: true };
runShim('jwt-validator-reject', engine, runProbe);
