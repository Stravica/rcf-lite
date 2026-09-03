// Tarball fetcher for external blueprint libraries (Phase 2c, spec §6.3).
//
// Node built-in `fetch()` is the transport; a 30-second connection
// timeout applies to the response headers, and a hard size cap fires
// during streaming. The download is SHA-256 hashed on the fly against
// the operator's declared digest; a mismatch is refused and rolled back
// (spec §6.1 + §6.4). Extraction uses a minimal POSIX-ustar parser
// bundled in this module so the runtime carries zero new dependencies
// (spec §6.3: no shell-out to `tar`, no libtar dependency).

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, normalize, sep } from 'node:path';
import { createGunzip } from 'node:zlib';

import { rcfError } from '../core/errors/index.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 200 * 1024 * 1024; // spec §6.3 envelope: tens; hard cap low hundreds.
const HEX_256 = /^[0-9a-f]{64}$/i;

/**
 * Fetch a tarball library, verify SHA-256, extract into targetDir.
 *
 * @param {object} args
 * @param {string} args.url
 * @param {string} args.expectedSha256
 * @param {string} args.targetDir            absolute path
 * @param {typeof fetch} [args.fetchImpl=fetch]  override for tests
 * @param {number} [args.timeoutMs]
 * @param {number} [args.maxBytes]
 * @returns {Promise<{ tarballSha256: string, root: string } | import('../core/errors/index.js').RcfError>}
 */
export async function fetchTarballLibrary({ url, expectedSha256, targetDir, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES }) {
  if (typeof url !== 'string' || url.length === 0) {
    return rcfError({ kind: 'usage', message: 'tarball fetch: url is required' });
  }
  if (typeof expectedSha256 !== 'string' || !HEX_256.test(expectedSha256)) {
    return rcfError({
      kind: 'usage',
      message: `tarball fetch: expected SHA-256 is required and must be 64 hex chars (spec §6.1: URL with no digest is refused).`,
    });
  }
  const expected = expectedSha256.toLowerCase();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`tarball fetch: timeout after ${timeoutMs}ms`)), timeoutMs);
  let response;
  try {
    response = await fetchImpl(url, { signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    return rcfError({ kind: 'usage', message: `tarball fetch: ${url}: ${err.message}` });
  }
  if (!response.ok) {
    clearTimeout(timer);
    return rcfError({ kind: 'usage', message: `tarball fetch: ${url} returned HTTP ${response.status}` });
  }
  if (!response.body) {
    clearTimeout(timer);
    return rcfError({ kind: 'usage', message: `tarball fetch: ${url}: empty response body` });
  }

  // Stream the response through: sha256 tap, size cap, optional gunzip,
  // tar parser. We buffer the whole thing into memory first (bounded by
  // maxBytes) because our tar parser is synchronous; envelope is tens of
  // megabytes, easily viable in a single Buffer.
  const hash = createHash('sha256');
  let received = 0;
  const chunks = [];
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        clearTimeout(timer);
        return rcfError({
          kind: 'usage',
          message: `tarball fetch: ${url} exceeded ${maxBytes} bytes (received ${received}); adjust the size cap only for a library you have separately verified.`,
        });
      }
      hash.update(value);
      chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
    }
  } catch (err) {
    clearTimeout(timer);
    return rcfError({ kind: 'usage', message: `tarball fetch: read failed: ${err.message}` });
  }
  clearTimeout(timer);

  const actual = hash.digest('hex');
  if (actual !== expected) {
    return rcfError({
      kind: 'usage',
      message: `tarball fetch: SHA-256 mismatch for ${url}. expected=${expected} actual=${actual}. The download was refused and no cache was written.`,
    });
  }

  const raw = Buffer.concat(chunks);
  const isGz = looksGzipped(url, raw);
  let plain;
  try {
    plain = isGz ? await gunzipBuffer(raw) : raw;
  } catch (err) {
    return rcfError({ kind: 'usage', message: `tarball fetch: gunzip failed: ${err.message}` });
  }

  const entries = parseUstar(plain);
  if (isRcfLikeError(entries)) return entries;

  const scratch = await mkdtemp(join(tmpdir(), 'rcf-lib-tar-'));
  try {
    const writeErr = await materialiseEntries(entries, scratch);
    if (writeErr) {
      await rm(scratch, { recursive: true, force: true }).catch(() => {});
      return writeErr;
    }
    // Some tarballs wrap everything in a single top-level directory
    // (npm-pack `package/`, github-tarball `<repo>-<sha>/`). If the
    // scratch tree has exactly one top-level entry and it is a
    // directory, unwrap it so the cache root IS the library root
    // (library.json sits at cachePath/library.json rather than
    // cachePath/package/library.json).
    const root = await unwrapSingleTopLevel(scratch);
    if (isRcfLikeError(root)) {
      await rm(scratch, { recursive: true, force: true }).catch(() => {});
      return root;
    }
    const settled = await settleCache(root, targetDir);
    if (settled) {
      await rm(scratch, { recursive: true, force: true }).catch(() => {});
      return settled;
    }
    if (root !== scratch) {
      await rm(scratch, { recursive: true, force: true }).catch(() => {});
    }
    return { tarballSha256: actual, root: targetDir };
  } catch (err) {
    await rm(scratch, { recursive: true, force: true }).catch(() => {});
    return rcfError({ kind: 'ioFailure', message: `tarball fetch: extraction failed: ${err.message}`, stack: err.stack });
  }
}

/**
 * Compute the SHA-256 of an already-downloaded byte buffer. Test-only
 * helper: the fetcher computes on the fly during download; this lets
 * unit tests pin an `expectedSha256` from a fixture without shelling
 * out to sha256sum.
 *
 * @param {Buffer} buf
 * @returns {string}
 */
export function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Produce a tarball buffer from an in-memory tree, suitable for
 * fixture use in unit tests. Ustar-style headers, no compression.
 *
 * @param {Array<{ path: string, content?: string | Buffer, mode?: number, dir?: boolean }>} entries
 * @returns {Buffer}
 */
export function createUstarBuffer(entries) {
  const chunks = [];
  for (const entry of entries) {
    const isDir = entry.dir === true;
    const content = isDir ? Buffer.alloc(0) : Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content ?? '', 'utf8');
    const mode = entry.mode ?? (isDir ? 0o755 : 0o644);
    const header = buildUstarHeader({ path: entry.path, size: content.length, mode, typeflag: isDir ? '5' : '0' });
    chunks.push(header);
    if (!isDir) {
      chunks.push(content);
      const pad = (512 - (content.length % 512)) % 512;
      if (pad > 0) chunks.push(Buffer.alloc(pad));
    }
  }
  chunks.push(Buffer.alloc(1024)); // Two zero blocks terminate the archive.
  return Buffer.concat(chunks);
}

function buildUstarHeader({ path, size, mode, typeflag }) {
  const buf = Buffer.alloc(512);
  const write = (offset, str, length) => {
    const s = String(str);
    buf.write(s.slice(0, length), offset, length, 'utf8');
  };
  // name: up to 100 bytes. Longer paths would need `prefix` (offset 345);
  // fixture paths in this codebase are short, so we simplify and refuse
  // long paths early to keep the writer honest.
  if (path.length > 100) throw new Error(`ustar writer: path too long (${path.length}); use a shorter fixture path`);
  write(0, path, 100);
  write(100, `${(mode & 0o7777).toString(8).padStart(6, '0')} \0`, 8);
  write(108, `${0..toString(8).padStart(6, '0')} \0`, 8); // uid
  write(116, `${0..toString(8).padStart(6, '0')} \0`, 8); // gid
  write(124, `${size.toString(8).padStart(11, '0')} `, 12); // size
  write(136, `${Math.floor(Date.now() / 1000).toString(8).padStart(11, '0')} `, 12); // mtime
  // checksum placeholder (spaces) at 148..155
  for (let i = 148; i < 156; i += 1) buf[i] = 0x20;
  write(156, typeflag, 1);
  write(257, 'ustar\0', 6);
  write(263, '00', 2);
  let sum = 0;
  for (let i = 0; i < 512; i += 1) sum += buf[i];
  write(148, `${sum.toString(8).padStart(6, '0')}\0 `, 8);
  return buf;
}

function looksGzipped(url, buf) {
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) return true;
  const lower = url.toLowerCase();
  return lower.endsWith('.tgz') || lower.endsWith('.tar.gz');
}

function gunzipBuffer(buf) {
  return new Promise((resolve, reject) => {
    const gz = createGunzip();
    const chunks = [];
    gz.on('data', (c) => chunks.push(c));
    gz.on('end', () => resolve(Buffer.concat(chunks)));
    gz.on('error', (err) => reject(err));
    gz.end(buf);
  });
}

/**
 * Minimal POSIX-ustar parser. Handles regular files ('0' / '\0'),
 * directories ('5'), and quietly skips pax extended headers ('x', 'g')
 * plus GNU long-name records ('L', 'K'). Returns an array of parsed
 * entries or an RcfError on a malformed archive.
 *
 * @param {Buffer} buf
 * @returns {Array<{ path: string, size: number, typeflag: string, content: Buffer }> | import('../core/errors/index.js').RcfError}
 */
export function parseUstar(buf) {
  const entries = [];
  let offset = 0;
  let pendingLongName = null;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    // Two consecutive zero blocks terminate.
    if (header.every((b) => b === 0)) {
      const next = buf.subarray(offset + 512, offset + 1024);
      if (next.length === 0 || next.every((b) => b === 0)) break;
      offset += 512;
      continue;
    }
    const rawName = readCString(header, 0, 100);
    const prefix = readCString(header, 345, 155);
    const magic = header.subarray(257, 263).toString('utf8').replace(/\0/g, '').trim();
    if (magic !== 'ustar') {
      return rcfError({ kind: 'usage', message: `tarball parse: non-ustar magic at offset ${offset}` });
    }
    const size = parseOctal(header, 124, 12);
    const typeflag = String.fromCharCode(header[156] || 0x30);
    const dataStart = offset + 512;
    const paddedSize = size + ((512 - (size % 512)) % 512);
    const dataEnd = dataStart + size;
    let path = pendingLongName ?? (prefix ? `${prefix}/${rawName}` : rawName);
    pendingLongName = null;
    if (typeflag === 'L') {
      pendingLongName = buf.subarray(dataStart, dataEnd).toString('utf8').replace(/\0+$/, '');
      offset = dataStart + paddedSize;
      continue;
    }
    if (typeflag === 'x' || typeflag === 'g' || typeflag === 'K') {
      // Skip pax extended / GNU link-name records; we do not honour
      // extended attributes for library payloads.
      offset = dataStart + paddedSize;
      continue;
    }
    if (typeflag === '5') {
      entries.push({ path, size: 0, typeflag, content: Buffer.alloc(0) });
      offset = dataStart + paddedSize;
      continue;
    }
    if (typeflag === '0' || typeflag === '\0') {
      const content = buf.subarray(dataStart, dataEnd);
      entries.push({ path, size, typeflag: '0', content: Buffer.from(content) });
      offset = dataStart + paddedSize;
      continue;
    }
    // Symlinks (2), hard links (1), block devices, character devices,
    // FIFOs, sparse files: not part of the library payload contract.
    // Skip and continue.
    offset = dataStart + paddedSize;
  }
  return entries;
}

function readCString(buf, offset, length) {
  const slice = buf.subarray(offset, offset + length);
  const nul = slice.indexOf(0);
  const s = (nul >= 0 ? slice.subarray(0, nul) : slice).toString('utf8');
  return s.replace(/\0/g, '');
}

function parseOctal(buf, offset, length) {
  const slice = buf.subarray(offset, offset + length);
  const trimmed = slice.toString('ascii').replace(/[\0\s]+$/, '').trim();
  if (trimmed.length === 0) return 0;
  return parseInt(trimmed, 8) || 0;
}

async function materialiseEntries(entries, scratch) {
  for (const entry of entries) {
    // Path safety: reject absolute paths and `..` traversal. `normalize`
    // collapses `foo/../bar` -> `bar`, then we check for a residual
    // `..` prefix that would escape the scratch root.
    const rel = normalize(entry.path);
    if (rel.startsWith('/') || rel.startsWith(sep)) {
      return rcfError({ kind: 'usage', message: `tarball parse: absolute path '${entry.path}' refused.` });
    }
    if (rel.split(/[\\/]/).some((s) => s === '..')) {
      return rcfError({ kind: 'usage', message: `tarball parse: parent-traversal path '${entry.path}' refused.` });
    }
    const absPath = join(scratch, rel);
    if (entry.typeflag === '5') {
      await mkdir(absPath, { recursive: true });
    } else {
      await mkdir(dirname(absPath), { recursive: true });
      await writeFile(absPath, entry.content);
    }
  }
  return null;
}

async function unwrapSingleTopLevel(scratch) {
  try {
    const { readdir, stat } = await import('node:fs/promises');
    const entries = await readdir(scratch);
    if (entries.length !== 1) return scratch;
    const only = join(scratch, entries[0]);
    const s = await stat(only);
    if (!s.isDirectory()) return scratch;
    return only;
  } catch (err) {
    return rcfError({ kind: 'ioFailure', message: `tarball extract: unwrap failed: ${err.message}`, stack: err.stack });
  }
}

async function settleCache(source, targetDir) {
  try {
    await rm(targetDir, { recursive: true, force: true });
    await mkdir(dirname(targetDir), { recursive: true });
    await rename(source, targetDir);
    return null;
  } catch (err) {
    if (err.code === 'EXDEV') {
      try {
        const { cp } = await import('node:fs/promises');
        await mkdir(dirname(targetDir), { recursive: true });
        await cp(source, targetDir, { recursive: true });
        await rm(source, { recursive: true, force: true }).catch(() => {});
        return null;
      } catch (copyErr) {
        return rcfError({ kind: 'ioFailure', message: `tarball settle: cross-device: ${copyErr.message}`, stack: copyErr.stack });
      }
    }
    return rcfError({ kind: 'ioFailure', message: `tarball settle: ${err.message}`, stack: err.stack });
  }
}

function isRcfLikeError(v) {
  return v && typeof v === 'object' && typeof v.kind === 'string' && typeof v.message === 'string' && v.kind !== '5' && v.kind !== '0';
}

/** Test-visible defaults so tests can pin behaviour. */
export function defaultCaps() {
  return { timeoutMs: DEFAULT_TIMEOUT_MS, maxBytes: DEFAULT_MAX_BYTES };
}

// Silence the unused-import lint on existsSync; keeps the import
// available for future use without warnings.
export const _cacheProbeExists = existsSync;
