import runProbe from './manifest-schema-validate.mjs';
import { runShim } from './probe-utils.mjs';

const engine = {
  kind: 'schema-validate',
  image: 'hetzner-throwaway-server fixture manifest directory (draft-07 subset in-process)',
  healthy: true,
};
runShim('manifest-schema-validate', engine, runProbe);
