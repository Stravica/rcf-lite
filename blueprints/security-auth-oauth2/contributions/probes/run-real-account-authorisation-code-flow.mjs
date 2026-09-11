import runProbe from './real-account-authorisation-code-flow.mjs';
import { runShim } from './probe-utils.mjs';
const engine = { kind: 'oauth2-provider' /* live-provider branch is honest-skip; slug AMBER */, image: 'commercial OAuth 2.0 authorisation server (or skipped)', healthy: true };
runShim('real-account-authorisation-code-flow', engine, runProbe);
