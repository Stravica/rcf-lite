// Finalise-gate barrel (spec §8). build-lite's finalise step invokes rcf-verify
// as a fresh subprocess with the isolation env (spawn.js), gates the
// complete -> verified transition on the subprocess exit code AND the report's
// ship authority (spec §4 - a correctness-only pass holds without promoting),
// ingests findings from the --out report (ingest.js), and - when rcf-verify is
// absent - prompts to install rather than silently skipping the gate (detect.js
// + install.js).

export { detectVerify, findOnPath, resolvePackageBin, VERIFY_PACKAGE, VERIFY_BIN } from './detect.js';
export { buildVerifyArgs, spawnVerify } from './spawn.js';
export { promptYesNo, installVerify, resolveAbsentVerify } from './install.js';
export { loadReport, summariseReport } from './ingest.js';
