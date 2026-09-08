import runProbe from './cloud-init-render-lint.mjs';
import { runShim } from './probe-utils.mjs';

const engine = {
  kind: 'template-render',
  image: 'hetzner-throwaway-server fixture (in-process template render)',
  healthy: true,
};
runShim('cloud-init-render-lint', engine, runProbe);
