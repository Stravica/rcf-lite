/**
 * Shim: run apply-time-refusal against a scratch project (bare init, no
 * applied blueprints) and write
 * .rcf/reports/blueprints/jobs-background/apply-time-refusal.json.
 */

import runProbe from './apply-time-refusal.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'cli', tool: 'rcf define blueprint add (bare scratch project)', healthy: true };
runShim('apply-time-refusal', engine, runProbe);
