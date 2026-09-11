import runProbe from './authorisation-code-flow-shape.mjs';
import { runShim } from './probe-utils.mjs';
const engine = { kind: 'fixture', image: 'in-process mock RFC 6749 + RFC 7636 server on 127.0.0.1', healthy: true };
runShim('authorisation-code-flow-shape', engine, runProbe);
