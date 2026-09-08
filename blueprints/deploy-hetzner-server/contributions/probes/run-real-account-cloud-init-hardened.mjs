import runProbe from './real-account-cloud-init-hardened.mjs';
import { runShim } from './probe-utils.mjs';

const engine = {
  kind: 'real-account-ssh',
  image: 'Hetzner Cloud throwaway cx23 with cloud-init user-data (ssh baseline checks)',
  healthy: true,
};
runShim('real-account-cloud-init-hardened', engine, runProbe);
