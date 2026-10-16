// Preload for the FBS-218 no-spawn test (AC-19201-7). Loaded with
// `node --import <this file>` in the child running bin/rcf.js. Wraps every
// node:child_process launcher so a call appends one JSON line to the file
// named by RCF_SPAWN_TRACE, then syncs the ESM named exports so static and
// dynamic `import('node:child_process')` both see the wrapped functions.
import childProcess from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const tracePath = process.env.RCF_SPAWN_TRACE;
const LAUNCHERS = ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'];

if (tracePath) {
  for (const name of LAUNCHERS) {
    const original = childProcess[name];
    childProcess[name] = function traced(...args) {
      appendFileSync(tracePath, `${JSON.stringify({ fn: name, file: String(args[0]) })}\n`);
      return original.apply(this, args);
    };
  }
  syncBuiltinESMExports();
}
