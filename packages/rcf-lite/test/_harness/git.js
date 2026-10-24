// Shared test harness (GR-40): git fixture helpers. Builds fixture
// repositories with the system git in the harness environment; imports
// Node builtins and the harness only.

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { baseEnv } from './spawn.js';

/** Run git in dir; returns trimmed stdout, throws on a non-zero exit. */
export function git(dir, ...args) {
  return execFileSync('git', args, { cwd: dir, env: baseEnv(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Run git in dir; returns { code, stdout, stderr } without throwing. */
export function gitTry(dir, ...args) {
  try {
    return { code: 0, stdout: execFileSync('git', args, { cwd: dir, env: baseEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), stderr: '' };
  } catch (err) {
    return { code: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

/** git init -b main in dir. */
export function initRepo(dir) {
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  return dir;
}

/**
 * Write files (path -> string content, or null to delete) and commit them
 * with the subject and optional body and trailers. Returns the full sha.
 * trailers: [['Hand', 'builder'], ...] land in the last paragraph.
 */
export function commit(dir, subject, files = {}, { trailers = [], body = '', allowEmpty = false } = {}) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    if (content === null) { rmSync(abs, { force: true }); continue; }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
  }
  git(dir, 'add', '-A');
  const parts = [subject];
  if (body) parts.push(body);
  if (trailers.length) parts.push(trailers.map(([k, v]) => `${k}: ${v}`).join('\n'));
  const args = ['commit', '-q', '-m', parts.join('\n\n')];
  if (allowEmpty) args.push('--allow-empty');
  git(dir, ...args);
  return git(dir, 'rev-parse', 'HEAD');
}

/** The full sha of a ref. */
export function sha(dir, ref = 'HEAD') {
  return git(dir, 'rev-parse', ref);
}

/** First 7 and first 12 characters of a sha. */
export const s7 = (s) => s.slice(0, 7);
export const s12 = (s) => s.slice(0, 12);

/** git status --porcelain (raw, untrimmed lines kept in order). */
export function porcelain(dir) {
  return execFileSync('git', ['status', '--porcelain'], { cwd: dir, env: baseEnv(), encoding: 'utf8' });
}
