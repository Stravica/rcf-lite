// FBS-238 (US-20102, TAC-4157): the cold installer. A package target is
// installed the way a brand-new consumer installs it: a fresh scratch
// directory under the OS temporary directory holding its own HOME, an
// empty npm cache and the install project, the user npmrc pointed inside
// it, and a reduced environment (PATH, TMPDIR and the scratch settings
// only), so nothing from the caller's machine reaches the run. The caller
// removes the scratch directory after the run.

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { recordSpawn } from '../../audit/separation.js';

/**
 * A fresh run scratch directory and the reduced environment every child of
 * a cold run gets.
 *
 * @param {NodeJS.ProcessEnv} [callerEnv]
 * @returns {{ scratch: string, env: NodeJS.ProcessEnv }}
 */
export function coldScratch(callerEnv = process.env) {
  const scratch = mkdtempSync(join(tmpdir(), 'rcf-release-'));
  const home = join(scratch, 'home');
  const cache = join(scratch, 'npm-cache');
  mkdirSync(home);
  mkdirSync(cache);
  const env = {
    PATH: callerEnv.PATH ?? '',
    HOME: home,
    npm_config_cache: cache,
    npm_config_userconfig: join(home, '.npmrc'),
    RCF_TARGET_KIND: 'package',
  };
  if (callerEnv.TMPDIR !== undefined) env.TMPDIR = callerEnv.TMPDIR;
  return { scratch, env };
}

/**
 * Run a child to completion through the spawn log seam; never rejects.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd: string, env: NodeJS.ProcessEnv }} opts
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
export function runChild(command, args, { cwd, env }) {
  recordSpawn(command, args);
  return new Promise((res) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d) => { stdout += d; });
    child.stderr.setEncoding('utf8').on('data', (d) => { stderr += d; });
    child.on('error', (err) => res({ code: 1, stdout, stderr: `${stderr}${err.message}\n` }));
    child.on('close', (code) => res({ code: code ?? 1, stdout, stderr }));
  });
}

/**
 * Install the tarball cold into <scratch>/install.
 *
 * @param {object} p
 * @param {string} p.scratch - from coldScratch
 * @param {NodeJS.ProcessEnv} p.env - from coldScratch
 * @param {string} p.tgz - absolute path to the packed artefact
 * @returns {Promise<{ command: string, exitCode: number, log: string, dir: string, name: string|null, version: string|null }>}
 */
export async function installCold({ scratch, env, tgz }) {
  const dir = join(scratch, 'install');
  mkdirSync(dir);
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name: 'rcf-release-scratch', private: true }, null, 2)}\n`, 'utf8');
  const args = ['install', '--no-audit', '--no-fund', tgz];
  const r = await runChild('npm', args, { cwd: dir, env });
  const out = { command: `npm ${args.join(' ')}`, exitCode: r.code, log: `${r.stdout}${r.stderr}`, dir, name: null, version: null };
  if (r.code !== 0) return out;
  const name = Object.keys(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).dependencies ?? {})[0] ?? null;
  if (!name) return out;
  const version = JSON.parse(readFileSync(join(dir, 'node_modules', name, 'package.json'), 'utf8')).version ?? null;
  return { ...out, name, version };
}
