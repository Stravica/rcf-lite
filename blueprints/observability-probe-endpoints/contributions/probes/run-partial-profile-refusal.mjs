import runProbe from './partial-profile-refusal.mjs';
import { runShim } from './probe-utils.mjs';
runShim('partial-profile-refusal', { kind: 'in-process', driver: 'profile registry refusal shim', healthy: true }, runProbe);
