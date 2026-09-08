// Fixture-side reviewer boot for the platform-docker-compose-host secrets-as-files-scan probe (round-7 T-2).
// Runs from the fixture directory as written:
//   cd packages/rcf-lite/test/fixtures/hetzner-throwaway-server && node ./run-secrets-as-files-scan.mjs
// Delegates to the blueprint's own shim so probe logic and report path stay
// in one place (blueprints/platform-docker-compose-host/contributions/probes/).
import '../../../../../blueprints/platform-docker-compose-host/contributions/probes/run-secrets-as-files-scan.mjs';
