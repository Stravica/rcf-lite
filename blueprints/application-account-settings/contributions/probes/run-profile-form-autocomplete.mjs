import runProbe from './profile-form-autocomplete.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'fixture', image: 'test/fixtures/probe-pack-application-account-settings/server.js', healthy: true };
runShim('profile-form-autocomplete', engine, runProbe);
