import runProbe from './stepper-role-dialog.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'fixture', image: 'test/fixtures/probe-pack-application-onboarding-tour/server.js', healthy: true };
runShim('stepper-role-dialog', engine, runProbe);
