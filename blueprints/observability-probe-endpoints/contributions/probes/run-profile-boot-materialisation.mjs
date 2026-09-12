import runProbe from './profile-boot-materialisation.mjs';
import { runShim } from './probe-utils.mjs';
runShim('profile-boot-materialisation', { kind: 'http', driver: 'node:http fixture profile registry on 127.0.0.1', healthy: true }, runProbe);
