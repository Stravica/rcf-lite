// FBS-226 (US-19302, TAC-4151): the pack step of package target mode.
// `rcf verify run --package <dir>` packs the artefact from the committed
// HEAD itself: git exports HEAD's tree into a scratch directory under the OS
// temporary directory (a throwaway index, so the project's own index and
// work tree are never touched), and npm pack runs in <dir>'s path inside
// that export. Ignored or lifecycle-written content in the live directory
// never reaches the bytes, and a prepack writes only into the export. The
// tarball goes to FBS-225's suite-as-probe path. Spawns only git and npm.

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Export `headSha` of the repository at `top` into a scratch directory,
 * then run `npm pack --pack-destination <scratch> --json` in `prefix`
 * inside the export. The caller removes the scratch directory after the run.
 * Never rejects: a failed pack is { exitCode != 0, tgz: null }; exitCode is
 * the code npm returned.
 *
 * @param {object} p
 * @param {string} p.top - absolute path to the repository's work tree root
 * @param {string} p.headSha - the committed head to pack
 * @param {string} p.prefix - the package directory's path in the repository ('' at its root)
 * @param {NodeJS.ProcessEnv} [p.env]
 * @returns {Promise<{ scratch: string, command: string, exitCode: number, log: string, tgz: string|null, name: string|null, version: string|null }>}
 */
export async function packDirectory({ top, headSha, prefix, env = process.env }) {
  const scratch = mkdtempSync(join(tmpdir(), 'rcf-pack-'));
  const tree = join(scratch, 'head');
  const destination = join(scratch, 'out');
  mkdirSync(destination);
  const args = ['pack', '--pack-destination', destination, '--json'];
  const command = `npm ${args.join(' ')}`;
  try {
    const gitEnv = { ...env, GIT_INDEX_FILE: join(scratch, 'index') };
    const opts = { cwd: top, env: gitEnv, stdio: ['ignore', 'pipe', 'pipe'] };
    execFileSync('git', ['read-tree', headSha], opts);
    execFileSync('git', ['checkout-index', '--all', `--prefix=${tree}/`], opts);
  } catch (err) {
    return { scratch, command, exitCode: 1, log: `could not export ${headSha}: ${err.stderr ?? ''}${err.message}\n`, tgz: null, name: null, version: null };
  }
  const r = await new Promise((res) => {
    const child = spawn('npm', args, { cwd: join(tree, prefix), env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d) => { stdout += d; });
    child.stderr.setEncoding('utf8').on('data', (d) => { stderr += d; });
    child.on('error', (err) => res({ code: 1, stdout, stderr: `${stderr}${err.message}\n` }));
    child.on('close', (code) => res({ code: code ?? 1, stdout, stderr }));
  });
  const out = { scratch, command, exitCode: r.code, log: `${r.stdout}${r.stderr}`, tgz: null, name: null, version: null };
  if (r.code !== 0) return out;
  try {
    // The identity npm read from the packed manifest: the JSON array npm
    // prints after any lifecycle script's own stdout lines.
    const at = r.stdout.search(/^\[\s*$/m);
    if (at < 0) return out;
    const [entry] = JSON.parse(r.stdout.slice(at));
    return { ...out, tgz: join(destination, entry.filename), name: entry.name ?? null, version: entry.version ?? null };
  } catch {
    return out;
  }
}
