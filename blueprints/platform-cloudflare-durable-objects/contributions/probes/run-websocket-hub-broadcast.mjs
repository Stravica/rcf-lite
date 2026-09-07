import runProbe from './websocket-hub-broadcast.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'in-process', image: 'in-process HubObject on cf-platform fixture', healthy: true };
runShim('websocket-hub-broadcast', engine, runProbe);
