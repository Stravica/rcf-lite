// Fixture-side reviewer boot for the real-account-throwaway-server-provision probe.
// Runs from the fixture directory as written:
//   cd packages/rcf-lite/test/fixtures/hetzner-throwaway-server && node ./run-real-account-throwaway-server-provision.mjs
// Delegates to the blueprint's own shim so probe logic and report path stay
// in one place (blueprints/deploy-hetzner-server/contributions/probes/).
import '../../../../../blueprints/deploy-hetzner-server/contributions/probes/run-real-account-throwaway-server-provision.mjs';
