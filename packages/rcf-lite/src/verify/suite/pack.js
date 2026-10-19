// FBS-226 (US-19302, TAC-4151): the pack step of package target mode.
// `rcf verify run --package <dir>` packs the artefact from the committed
// HEAD with npm pack into a scratch directory under the OS temporary
// directory, never into <dir>, and hands the tarball to FBS-225's
// suite-as-probe path. Spawns only npm.

import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Run `npm pack --pack-destination <scratch> --json` in the package
 * directory. The caller removes the scratch directory after the run.
 * Never rejects: a failed pack is { exitCode != 0, tgz: null }.
 *
 * @param {object} p
 * @param {string} p.dir - absolute path to the package directory
 * @param {NodeJS.ProcessEnv} [p.env]
 * @returns {Promise<{ scratch: string, command: string, exitCode: number, log: string, tgz: string|null, name: string|null, version: string|null }>}
 */
export async function packDirectory({ dir, env = process.env }) {
  const scratch = mkdtempSync(join(tmpdir(), 'rcf-pack-'));
  const args = ['pack', '--pack-destination', scratch, '--json'];
  const r = await new Promise((res) => {
    const child = spawn('npm', args, { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d) => { stdout += d; });
    child.stderr.setEncoding('utf8').on('data', (d) => { stderr += d; });
    child.on('error', (err) => res({ code: 1, stdout, stderr: `${stderr}${err.message}\n` }));
    child.on('close', (code) => res({ code: code ?? 1, stdout, stderr }));
  });
  const out = { scratch, command: `npm ${args.join(' ')}`, exitCode: r.code, log: `${r.stdout}${r.stderr}`, tgz: null, name: null, version: null };
  if (r.code !== 0) return out;
  try {
    // The identity npm read from the packed manifest.
    const [entry] = JSON.parse(r.stdout);
    return { ...out, tgz: join(scratch, entry.filename), name: entry.name ?? null, version: entry.version ?? null };
  } catch {
    return { ...out, exitCode: 1 };
  }
}
