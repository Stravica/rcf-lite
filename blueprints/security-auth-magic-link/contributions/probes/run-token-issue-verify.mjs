import runProbe from './token-issue-verify.mjs';
import { runShim } from './probe-utils.mjs';
const engine = { kind: 'fixture', image: 'fixture magic-link-manager (deterministic clock)', healthy: true };
runShim('token-issue-verify', engine, runProbe);
