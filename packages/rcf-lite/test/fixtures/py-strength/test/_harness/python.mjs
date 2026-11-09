// The fixture's shared harness: runs a short Python program against the
// project's src/ through the host's python3 as a child process (-B: no
// bytecode written; -I: isolated from the user's environment) and returns
// its exit code and output. A missing python3 throws: the test fails.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../../src/', import.meta.url));

export function python(lines) {
  const program = ['import sys', `sys.path.insert(0, ${JSON.stringify(src)})`, ...lines].join('\n');
  const r = spawnSync('python3', ['-B', '-I', '-c', program], { encoding: 'utf8', timeout: 20000 });
  if (r.error) throw r.error;
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
