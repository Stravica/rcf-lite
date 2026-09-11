import runProbe from './real-account-authorisation-code-flow.mjs';
import { runShim } from './probe-utils.mjs';
const engine = { kind: 'live-oauth2-provider', image: 'commercial OAuth 2.0 authorisation server (or skipped)', healthy: true };
runShim('real-account-authorisation-code-flow', engine, runProbe);
