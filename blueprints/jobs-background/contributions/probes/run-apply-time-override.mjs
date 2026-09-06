/**
 * Shim: run apply-time-override against a scratch bare project and
 * write .rcf/reports/blueprints/jobs-background/apply-time-override.json.
 */

import runProbe from './apply-time-override.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'cli', tool: 'rcf define blueprint add --allow-no-queue-yet (bare scratch project)', healthy: true };
runShim('apply-time-override', engine, runProbe);
