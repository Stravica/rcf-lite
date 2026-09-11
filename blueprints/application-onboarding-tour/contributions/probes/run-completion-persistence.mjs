import runProbe from './completion-persistence.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'fixture', image: 'test/fixtures/probe-pack-application-onboarding-tour/server.js', healthy: true };
runShim('completion-persistence', engine, runProbe);
