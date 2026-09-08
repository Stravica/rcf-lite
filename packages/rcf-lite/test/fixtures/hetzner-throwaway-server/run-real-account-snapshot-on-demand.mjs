// Fixture-side reviewer boot for the real-account-snapshot-on-demand probe.
// Runs from the fixture directory as written:
//   cd packages/rcf-lite/test/fixtures/hetzner-throwaway-server && node ./run-real-account-snapshot-on-demand.mjs
// Delegates to the blueprint's own shim so probe logic and report path stay
// in one place (blueprints/deploy-hetzner-server/contributions/probes/).
import '../../../../../blueprints/deploy-hetzner-server/contributions/probes/run-real-account-snapshot-on-demand.mjs';
