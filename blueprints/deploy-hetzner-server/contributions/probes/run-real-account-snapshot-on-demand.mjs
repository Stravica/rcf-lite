import runProbe from './real-account-snapshot-on-demand.mjs';
import { runShim } from './probe-utils.mjs';

const engine = {
  kind: 'real-account-snapshot',
  image: 'Hetzner Cloud throwaway cx23 with snapshot verb via hcloud image create-image',
  healthy: true,
};
runShim('real-account-snapshot-on-demand', engine, runProbe);
