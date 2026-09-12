import runProbe from './first-run-detection.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'fixture', image: 'test/fixtures/probe-pack-application-onboarding-tour/server.js', healthy: true };
runShim('first-run-detection', engine, runProbe);
