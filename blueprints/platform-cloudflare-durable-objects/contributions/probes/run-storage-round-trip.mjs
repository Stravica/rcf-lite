import runProbe from './storage-round-trip.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'in-process', image: 'in-process DO storage driver on cf-platform fixture', healthy: true };
runShim('storage-round-trip', engine, runProbe);
