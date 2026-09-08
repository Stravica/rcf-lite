import runProbe from './real-account-throwaway-server-provision.mjs';
import { runShim } from './probe-utils.mjs';

const engine = {
  kind: 'real-account-throwaway-server',
  image: 'Hetzner Cloud API via hcloud CLI (provision + list + destroy)',
  healthy: true,
};
runShim('real-account-throwaway-server-provision', engine, runProbe);
