// Supervisor log helpers (spec §9.2 `rcf view logs`).

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * @param {string} projectRoot
 */
export function supervisorLogPath(projectRoot) {
  return join(projectRoot, '.rcf', 'view-server.log');
}

export async function ensureLogDir(projectRoot) {
  const dir = dirname(supervisorLogPath(projectRoot));
  await mkdir(dir, { recursive: true });
}

export async function writeLogLine(projectRoot, line) {
  await ensureLogDir(projectRoot);
  await appendFile(supervisorLogPath(projectRoot), `${new Date().toISOString()} ${line}\n`, 'utf8');
}

export async function readLogTail(projectRoot, tail = 200) {
  try {
    const raw = await readFile(supervisorLogPath(projectRoot), 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    return lines.slice(-tail);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}
