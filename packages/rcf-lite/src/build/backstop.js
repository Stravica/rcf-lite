// FBS-239 (US-20201, US-20203, TAC-4158): the suite-green backstop on
// every `rcf build bundle`.
//
// The bundle refuses unless --base-suite names a BaseSuiteRecord v1 (written
// by `rcf build base-suite`, src/build/base-suite.js) for the base, the git
// merge-base of HEAD with the trunk (the first of origin/main,
// origin/master, main and master that resolves; HEAD itself on the trunk),
// with exit code 0 and no failing test. The backstop never reads
// executionStatus and never runs the suite: one `git cat-file --batch`
// process resolves the base. The 0.36.x verified backstop
// (rcf/define/backstop.json, `backstop adopt`, --allow-unverified) is
// retired: an existing file is ignored with one warn line.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { recordSpawn } from '../audit/separation.js';

export const BACKSTOP_REL_PATH = 'rcf/define/backstop.json';
export const RETIRED_BACKSTOP_FILE = '[warn] backstop: rcf/define/backstop.json is retired in 0.37.0 and ignored; the backstop is the base suite';
export const NOT_RECORDED = 'backstop: base suite not recorded; run rcf build base-suite --command "<suite>" --out <file> on the base and pass --base-suite <file>';

const TRUNKS = ['origin/main', 'origin/master', 'main', 'master'];
const s7 = (sha) => String(sha ?? '').slice(0, 7);

/**
 * A reader over `git cat-file --batch` output: next() resolves the next
 * response as { sha, type, content } or null for a missing object (or when
 * git has gone away).
 *
 * @param {import('node:stream').Readable} stream
 */
function batchReader(stream) {
  let buf = Buffer.alloc(0);
  let ended = false;
  const waiting = [];
  const pump = () => {
    while (waiting.length > 0) {
      const nl = buf.indexOf(10);
      if (nl < 0) {
        if (ended) waiting.shift()(null);
        else return;
        continue;
      }
      const header = buf.subarray(0, nl).toString('utf8');
      const m = /^([0-9a-f]{40,64}) (\S+) (\d+)$/.exec(header);
      if (!m) {
        buf = buf.subarray(nl + 1);
        waiting.shift()(null);
        continue;
      }
      const size = Number(m[3]);
      if (buf.length < nl + 1 + size + 1) {
        if (ended) waiting.shift()(null);
        else return;
        continue;
      }
      const content = buf.subarray(nl + 1, nl + 1 + size).toString('utf8');
      buf = buf.subarray(nl + 1 + size + 1);
      waiting.shift()({ sha: m[1], type: m[2], content });
    }
  };
  stream.on('data', (chunk) => { buf = Buffer.concat([buf, chunk]); pump(); });
  stream.on('end', () => { ended = true; pump(); });
  stream.on('error', () => { ended = true; pump(); });
  return {
    next: () => new Promise((res) => { waiting.push(res); pump(); }),
    close: () => { ended = true; pump(); },
  };
}

/** A commit object's parents and committer time. */
function parseCommit(obj) {
  const head = obj.content.split('\n\n')[0];
  const parents = [...head.matchAll(/^parent ([0-9a-f]+)$/gm)].map((m) => m[1]);
  const date = Number(/^committer .* (\d+) [+-]\d{4}$/m.exec(head)?.[1] ?? 0);
  return { sha: obj.sha, parents, date, flags: 0 };
}

/**
 * The newest merge-base of two commits, painting down by committer date as
 * git does (paint_down_to_common).
 */
async function mergeBase(a, b, load) {
  if (a.sha === b.sha) return a.sha;
  const P1 = 1;
  const P2 = 2;
  const STALE = 4;
  a.flags |= P1;
  b.flags |= P2;
  const queue = [a, b];
  while (queue.some((c) => !(c.flags & STALE))) {
    let at = 0;
    for (let i = 1; i < queue.length; i += 1) if (queue[i].date > queue[at].date) at = i;
    const c = queue.splice(at, 1)[0];
    let flags = c.flags & (P1 | P2 | STALE);
    if (flags === (P1 | P2)) return c.sha;
    for (const p of c.parents) {
      const pc = await load(p);
      if (!pc || (pc.flags & flags) === flags) continue;
      pc.flags |= flags;
      queue.push(pc);
    }
  }
  return null;
}

/**
 * The base a record must name: the merge-base of HEAD with the first
 * trunk ref that resolves, or HEAD itself when none does. One git process
 * (`git cat-file --batch`), recorded through the spawn seam. Null when the
 * project has no committed HEAD.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @returns {Promise<string|null>}
 */
export async function resolveBase({ projectRoot }) {
  const args = ['cat-file', '--batch'];
  recordSpawn('git', args);
  const child = spawn('git', args, { cwd: projectRoot, stdio: ['pipe', 'pipe', 'ignore'] });
  const reader = batchReader(child.stdout);
  child.on('error', () => reader.close());
  child.stdin.on('error', () => reader.close());
  const ask = (name) => {
    child.stdin.write(`${name}\n`);
    return reader.next();
  };
  const commits = new Map();
  const load = async (name) => {
    if (commits.has(name)) return commits.get(name);
    const obj = await ask(`${name}^{commit}`);
    const commit = obj ? parseCommit(obj) : null;
    if (commit) {
      if (commits.has(commit.sha)) return commits.get(commit.sha);
      commits.set(commit.sha, commit);
    }
    return commit;
  };
  try {
    const head = await load('HEAD');
    if (!head) return null;
    for (const ref of TRUNKS) {
      const trunk = await load(ref);
      if (trunk) return await mergeBase(head, trunk, load);
    }
    return head.sha;
  } finally {
    child.stdin.end();
  }
}

/** Whether a parsed record has the BaseSuiteRecord v1 shape (TAC-4158). */
function shapeError(rec) {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return 'not a JSON object';
  if (rec.version !== 1) return 'version is not 1';
  if (typeof rec.head !== 'string' || !/^[0-9a-f]{40}$/.test(rec.head)) return 'head is not a 40-hex commit';
  if (!Number.isInteger(rec.exitCode)) return 'exitCode is not an integer';
  if (rec.tap !== null && (typeof rec.tap !== 'object' || !Number.isInteger(rec.tap.fail))) return 'tap is neither null nor a TAP summary';
  if (typeof rec.green !== 'boolean') return 'green is not a boolean';
  return null;
}

/**
 * The backstop, before any other bundle gate. Returns { ok: true } or a
 * refusal { ok: false, code, message } (exit 4 not recorded, stale or red;
 * exit 2 an unreadable or malformed record, naming the file). Warns once
 * when the retired rcf/define/backstop.json exists; never reads or writes it.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {string|null} args.file - the --base-suite value
 * @param {NodeJS.WritableStream} args.stderr
 * @returns {Promise<{ ok: true } | { ok: false, code: 2|4, message: string }>}
 */
export async function checkBaseSuite({ projectRoot, file, stderr }) {
  if (existsSync(join(projectRoot, BACKSTOP_REL_PATH))) stderr.write(`${RETIRED_BACKSTOP_FILE}\n`);
  if (file === null || file === undefined) return { ok: false, code: 4, message: NOT_RECORDED };
  let rec;
  try {
    rec = JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    return { ok: false, code: 2, message: `[error] usage --base-suite ${file} cannot be read as a base-suite record: ${err.message}` };
  }
  const bad = shapeError(rec);
  if (bad) return { ok: false, code: 2, message: `[error] usage --base-suite ${file} is not a BaseSuiteRecord v1: ${bad}` };
  const base = await resolveBase({ projectRoot });
  if (rec.head !== base) {
    return { ok: false, code: 4, message: `backstop: base suite recorded at ${s7(rec.head)}, base is ${base ? s7(base) : 'none (no commit)'}; record it again` };
  }
  const failing = rec.tap?.fail ?? 0;
  if (rec.exitCode !== 0 || failing > 0 || rec.green !== true) {
    return { ok: false, code: 4, message: `backstop: base suite red at ${s7(base)}: exit ${rec.exitCode}, ${failing} failing; no Build starts until the RCF suite is green on the base` };
  }
  return { ok: true };
}

// The 0.36.x verified backstop (FBS-221, AC-19003-1 to AC-19003-5, all
// retired): no 0.37.0 command calls these; kept for those criteria's Code
// Nodes.

/**
 * Read the backstop record, or null when the file is absent.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @returns {Promise<object|null>}
 */
export async function loadBackstop({ projectRoot }) {
  let raw;
  try {
    raw = await readFile(join(projectRoot, BACKSTOP_REL_PATH), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  return JSON.parse(raw);
}

/**
 * The FBS inside the window still at `complete`, in queue order.
 *
 * @param {{ items: Array<{fbsId: string, buildOrder: number, executionStatus: string}> }} queue
 * @param {{ fromBuildOrder: number }} backstop
 * @returns {string[]}
 */
export function unverifiedInWindow(queue, backstop) {
  return queue.items
    .filter((i) => i.executionStatus === 'complete' && (i.buildOrder ?? 0) >= backstop.fromBuildOrder)
    .map((i) => i.fbsId);
}

/**
 * Write the backstop record: JSON, two-space indent, trailing newline.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {object} args.record
 * @returns {Promise<void>}
 */
export async function saveBackstop({ projectRoot, record }) {
  const filePath = join(projectRoot, BACKSTOP_REL_PATH);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}
