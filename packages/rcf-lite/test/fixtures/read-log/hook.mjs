// Test preload (AC-20501-2): loaded with node --import into every rcf
// process of the packed-tarball journey. It wraps the node:fs and
// node:fs/promises read, stat and directory calls and appends one line
// per path under RCF_READ_LOG_ROOT to the file RCF_READ_LOG, so the test
// can show that no command reads under the installed package's rcf/.
// It changes no result: every wrapped call returns what the real one does.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { resolve } from 'node:path';

const root = process.env.RCF_READ_LOG_ROOT;
const log = process.env.RCF_READ_LOG;
if (root && log) {
  const prefix = resolve(root) + '/';
  const append = fs.appendFileSync.bind(fs);
  const note = (name, p) => {
    try {
      const s = typeof p === 'string' ? p : (p instanceof URL ? p.pathname : (Buffer.isBuffer(p) ? p.toString() : null));
      if (s && (resolve(s) + '/').startsWith(prefix)) append(log, `${process.pid}\t${name}\t${resolve(s)}\n`);
    } catch { /* never change the wrapped call */ }
  };
  const wrap = (obj, names) => {
    for (const name of names) {
      const real = obj[name];
      if (typeof real !== 'function') continue;
      obj[name] = function wrapped(p, ...rest) { note(name, p); return real.call(this, p, ...rest); };
    }
  };
  wrap(fs, ['readFileSync', 'readFile', 'existsSync', 'statSync', 'stat', 'lstatSync', 'lstat', 'readdirSync', 'readdir', 'openSync', 'open', 'createReadStream', 'accessSync', 'access', 'realpathSync', 'opendirSync']);
  wrap(fsp, ['readFile', 'stat', 'lstat', 'readdir', 'open', 'access', 'realpath', 'opendir']);
  syncBuiltinESMExports();
}
