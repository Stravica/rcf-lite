import runProbe from './checklist-anchor-open.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'fixture', image: 'test/fixtures/probe-pack-application-onboarding-tour/server.js', healthy: true };
runShim('checklist-anchor-open', engine, runProbe);
