import runProbe from './hcloud-dry-run-mock.mjs';
import { runShim } from './probe-utils.mjs';

const engine = {
  kind: 'facade-round-trip',
  image: 'hetzner-throwaway-server fixture provisioner facade against a mocked hcloud shim',
  healthy: true,
};
runShim('hcloud-dry-run-mock', engine, runProbe);
