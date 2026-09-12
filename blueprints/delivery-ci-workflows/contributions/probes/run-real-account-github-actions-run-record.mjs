import runProbe from './real-account-github-actions-run-record.mjs';
import { runShim } from './probe-utils.mjs';
runShim('real-account-github-actions-run-record', { kind: 'gh', driver: 'gh CLI read-only (workflow runs)', healthy: true }, runProbe);
