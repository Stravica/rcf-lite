// Sample-app fixture for the application-file-upload probe pack.
//
// Dependency-free Node HTTP server. Realises the file-upload
// contract honestly on /upload so every pack check can run against
// a real DOM. Two transport branches (multipart POST default and
// tus.io 1.0.0 elicited alternative) render honestly; a small
// synthetic upload loop drives per-file and aggregate progress
// through the polite live-region wrapper, and break switches drive
// the negative runs from a single boot:
//
//   ?break=no-input        drops the file input leaving only the
//                          drop-zone (AC-23101-1 must fail; WCAG
//                          2.5.7 alternative gone)
//   ?break=no-live-region  drops the polite live-region wrapper
//                          (AC-23102-1 must fail)
//   ?break=send-refused    sends a refused file to the server
//                          (AC-23103-1 must fail; the refused
//                          filename appears in the request log)
//   ?break=no-chunks       collapses the chunked path to a single
//                          POST (AC-23104-1 must fail; on multipart
//                          [data-chunks-uploaded] stays at 1; on
//                          tus no PATCH request is issued)
//
// PORT env picks the bind port (default 3000). Never binds 4200
// (reserved for the operator workspace). Prints LISTENING <port>
// once bound. EMPTY_ERROR_STATES_BREAK-style env fallback:
// FILE_UPLOAD_BREAK forces one of the break switches across every
// request; per-request ?break= still wins when both are set.
//
// Exports startServer({ port }) so the anatomy test can drive the
// same shell without spawning a child process, and exports
// TRANSPORTS and STATES for enumeration.

import http from 'node:http';
import { URL } from 'node:url';

export const TRANSPORTS = ['multipart', 'tus'];
export const STATES = ['idle', 'uploading', 'refused', 'complete'];
export const REFUSAL_REASONS = ['mime-refused', 'size-refused', 'virus-refused'];

const DEFAULT_BREAK = process.env.FILE_UPLOAD_BREAK || null;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function shellHead(title) {
  return `<title>${escapeHtml(title)}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; padding: 0; color: #111; }
  main { padding: 1.25rem 1.5rem; max-width: 720px; }
  [data-surface="file-upload"] { padding: 1rem; border-radius: 4px; border: 1px solid #d0d7e0; background: #f6f8fb; }
  [data-drop-zone] { display: block; padding: 1.5rem; border: 2px dashed #4a5b7a; border-radius: 4px; text-align: center; margin: 0.75rem 0; background: white; }
  [data-open-picker], button { padding: 0.35rem 0.75rem; cursor: pointer; }
  [data-file-row] { border-top: 1px solid #d0d7e0; padding: 0.5rem 0; }
  [data-file-row][data-refused="true"] { background: #fff4f2; border-left: 3px solid #d93025; padding-left: 0.5rem; }
  [data-live-region="polite"] { position: absolute; left: -9999px; top: -9999px; }
  [data-assertive-slot] { padding: 0.5rem; margin-top: 0.75rem; background: #ecf6ea; border: 1px solid #6a8b4a; border-radius: 4px; }
  [data-error-message] { color: #d93025; font-size: 0.9em; }
</style>`;
}

// Build the initial [data-file-row] elements for the seed. Rendering
// them server-side means a plain curl on ?seed=refused already sees
// the refused row with its aria-describedby binding, [data-refusal-reason]
// and [data-recovery="retry"] control; the client-side loop then
// advances chunk counters and the completion announcement.
function seededFileRows(seed) {
  if (seed === 'refused') {
    return [
      { name: 'ok.txt', size: 5 * 1024, totalChunks: 3, refused: false },
      { name: 'not-allowed.exe', size: 20 * 1024, totalChunks: 3, refused: true, reason: 'mime-refused' },
    ];
  }
  if (seed === 'large') {
    return [{ name: 'big.mov', size: 500 * 1024, totalChunks: 5, refused: false }];
  }
  return [
    { name: 'a.txt', size: 5 * 1024, totalChunks: 3, refused: false },
    { name: 'b.txt', size: 5 * 1024, totalChunks: 3, refused: false },
  ];
}

function renderFileRowHtml(f, idx) {
  if (f.refused) {
    return `<div data-file-row data-file-name="${escapeHtml(f.name)}" data-file-state="refused" data-chunks-uploaded="0" data-refused="true" data-refusal-reason="${escapeHtml(f.reason)}" data-refused-filename="${escapeHtml(f.name)}" aria-describedby="err-${idx}">
  <span>${escapeHtml(f.name)} </span>
  <span data-file-progress role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">0</span>
  <div data-error-message id="err-${idx}">This file was refused (${escapeHtml(f.reason)}). Please choose another file.</div>
  <button type="button" data-recovery="retry">Retry</button>
</div>`;
  }
  return `<div data-file-row data-file-name="${escapeHtml(f.name)}" data-file-state="idle" data-chunks-uploaded="0">
  <span>${escapeHtml(f.name)} </span>
  <span data-file-progress role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">0</span>
  <button type="button" data-recovery="remove">Remove</button>
</div>`;
}

// Build the upload page. Every honest render carries all three
// input affordances (file input, drop-zone, keyboard opener), the
// polite live-region wrapper, and the assertive slot. Break
// switches selectively drop pieces.
function uploadPage({ transport, break_, seed, autostart }) {
  const dropInputFileTag = break_ === 'no-input' ? '' : '<input id="filePicker" name="filePicker" type="file" multiple>';
  const dropInputLabel = break_ === 'no-input' ? '' : '<label for="filePicker">Add files</label>';
  const politeWrapper = break_ === 'no-live-region'
    ? ''
    : '<div data-live-region="polite" aria-live="polite" aria-atomic="true">0 of 0 files, 0 percent</div>';
  const assertiveSlot = '<div data-assertive-slot aria-live="assertive"></div>';
  const seedJson = JSON.stringify(seed || 'demo');
  const transportSlug = transport === 'tus' ? 'tus' : 'multipart';
  const breakJson = JSON.stringify(break_ || '');
  const autostartJson = autostart ? 'true' : 'false';
  const seedRows = seededFileRows(seed || 'demo');
  const initialRows = seedRows.map((f, idx) => renderFileRowHtml(f, idx)).join('\n');
  return `<!doctype html><html lang="en"><head>${shellHead('Upload files - Sample app')}</head><body>
<main>
<section data-surface="file-upload" data-transport="${transportSlug}" aria-labelledby="uploadHeading">
  <h1 id="uploadHeading">Add files</h1>
  ${dropInputLabel}
  ${dropInputFileTag}
  <div data-drop-zone tabindex="0" aria-label="Drop files here to upload">Drop files here</div>
  <button type="button" data-open-picker aria-label="Open file picker">Choose files</button>
  <div data-file-list>
${initialRows}
  </div>
  ${politeWrapper}
  ${assertiveSlot}
</section>
<script>
window.__uploadRequestLog = [];
window.__tusPatchOffsets = [];
const TRANSPORT = ${JSON.stringify(transportSlug)};
const BREAK = ${breakJson};
const SEED = ${seedJson};
const AUTOSTART = ${autostartJson};
const REFUSED_FILE_NAME = 'not-allowed.exe';
const REFUSED_REASON = 'mime-refused';
const LARGE_TOTAL_CHUNKS = 5;
const DEMO_TOTAL_CHUNKS = 3;
const REFUSED_TOTAL_CHUNKS = 3;

function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'text') e.textContent = v;
    else if (v === true) e.setAttribute(k, '');
    else if (v == null || v === false) { /* skip */ }
    else e.setAttribute(k, v);
  }
  for (const kid of kids) if (kid) e.appendChild(kid);
  return e;
}

function makeSeededFiles() {
  const files = [];
  if (SEED === 'refused') {
    files.push({ name: 'ok.txt', size: 5 * 1024, totalChunks: REFUSED_TOTAL_CHUNKS, refused: false });
    files.push({ name: REFUSED_FILE_NAME, size: 20 * 1024, totalChunks: REFUSED_TOTAL_CHUNKS, refused: true, reason: REFUSED_REASON });
  } else if (SEED === 'large') {
    files.push({ name: 'big.mov', size: 500 * 1024, totalChunks: LARGE_TOTAL_CHUNKS, refused: false });
  } else {
    files.push({ name: 'a.txt', size: 5 * 1024, totalChunks: DEMO_TOTAL_CHUNKS, refused: false });
    files.push({ name: 'b.txt', size: 5 * 1024, totalChunks: DEMO_TOTAL_CHUNKS, refused: false });
  }
  return files;
}

function renderFileRow(f, idx) {
  const rowAttrs = {
    'data-file-row': true,
    'data-file-name': f.name,
    'data-file-state': 'idle',
    'data-chunks-uploaded': '0',
  };
  if (f.refused) {
    rowAttrs['data-refused'] = 'true';
    rowAttrs['data-refusal-reason'] = f.reason;
    rowAttrs['data-refused-filename'] = f.name;
    rowAttrs['aria-describedby'] = 'err-' + idx;
  }
  const row = el('div', rowAttrs);
  row.appendChild(el('span', { text: f.name + ' ' }));
  const progress = el('span', { 'data-file-progress': true, role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0', text: '0' });
  row.appendChild(progress);
  if (f.refused) {
    const err = el('div', { 'data-error-message': true, id: 'err-' + idx, text: 'This file was refused (' + f.reason + '). Please choose another file.' });
    row.appendChild(err);
    const retry = el('button', { type: 'button', 'data-recovery': 'retry', text: 'Retry' });
    row.appendChild(retry);
  } else {
    const remove = el('button', { type: 'button', 'data-recovery': 'remove', text: 'Remove' });
    row.appendChild(remove);
  }
  return row;
}

function politeSet(text) {
  const live = document.querySelector('[data-live-region="polite"]');
  if (live) live.textContent = text;
}

function assertiveSet(text) {
  const slot = document.querySelector('[data-assertive-slot]');
  if (slot) slot.textContent = text;
}

async function simulateChunkUpload(row, f) {
  // Break: send refused sends the refused file to the server anyway.
  const shouldSendRefused = BREAK === 'send-refused';
  if (f.refused && !shouldSendRefused) {
    // No bytes on the wire for refused files; row stays at data-file-state="refused".
    return { refused: true };
  }
  row.setAttribute('data-file-state', 'uploading');
  const totalChunks = f.totalChunks;
  const effectiveTotal = BREAK === 'no-chunks' ? 1 : totalChunks;
  for (let i = 1; i <= effectiveTotal; i++) {
    if (TRANSPORT === 'tus') {
      const offset = i * Math.ceil(f.size / effectiveTotal);
      window.__tusPatchOffsets.push(offset);
      window.__uploadRequestLog.push({ method: 'PATCH', filename: f.name, offset, body: 'chunk:' + i, headers: { 'Upload-Offset': String(offset) } });
    } else {
      window.__uploadRequestLog.push({ method: 'POST', filename: f.name, body: 'chunk:' + i + ':' + f.name, chunk: i });
    }
    row.setAttribute('data-chunks-uploaded', String(i));
    const progress = row.querySelector('[data-file-progress]');
    const pct = Math.round((i / effectiveTotal) * 100);
    if (progress) {
      progress.setAttribute('aria-valuenow', String(pct));
      progress.textContent = String(pct);
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  row.setAttribute('data-file-state', 'complete');
  return { refused: false };
}

async function drive(files) {
  const list = document.querySelector('[data-file-list]');
  // Rows are pre-rendered server-side per the seed; the client-side
  // loop advances chunk counters and completion announcement over
  // the existing rows so the initial DOM already carries the
  // refused-row shape (aria-describedby, [data-refusal-reason],
  // [data-recovery="retry"]) for a plain curl.
  const total = files.length;
  let uploaded = 0;
  let completed = 0;
  for (const [idx, f] of files.entries()) {
    const row = list.children[idx];
    // Kick off a polite tick per file so the wrapper never sits at the seeded string.
    const pct = Math.round((uploaded / total) * 100);
    politeSet(String(uploaded) + ' of ' + total + ' files, ' + pct + ' percent');
    const res = await simulateChunkUpload(row, f);
    if (!res.refused) {
      uploaded += 1;
      completed += 1;
    }
    const donePct = Math.round((completed / total) * 100);
    politeSet(String(completed) + ' of ' + total + ' files, ' + donePct + ' percent');
  }
  // Assertive completion announcement fires exactly once per set.
  assertiveSet(String(completed) + ' files uploaded successfully');
}

document.querySelector('[data-open-picker]').addEventListener('click', () => {
  const picker = document.getElementById('filePicker');
  if (picker && typeof picker.focus === 'function') picker.focus();
});
document.querySelector('[data-open-picker]').addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' || ev.key === ' ') {
    const picker = document.getElementById('filePicker');
    if (picker && typeof picker.focus === 'function') picker.focus();
  }
});

if (AUTOSTART || SEED === 'refused') {
  const files = makeSeededFiles();
  drive(files).catch((err) => {
    politeSet('error: ' + (err && err.message ? err.message : String(err)));
  });
}
</script>
</main>
</body></html>`;
}

function indexPage() {
  return `<!doctype html><html lang="en"><head>${shellHead('file-upload fixture')}</head><body>
<main>
<h1>Sample app for application-file-upload</h1>
<p>Upload surface lives at <a href="/upload">/upload</a>. Add ?transport=multipart (default) or ?transport=tus to select the transport; add ?break=&lt;switch&gt; to drive a negative run. See README for the full switch list.</p>
<ul>
  <li><a href="/upload">/upload (multipart default)</a></li>
  <li><a href="/upload?transport=tus&seed=large&autostart=1">/upload?transport=tus&seed=large&autostart=1</a></li>
  <li><a href="/upload?seed=refused">/upload?seed=refused</a></li>
</ul>
</main>
</body></html>`;
}

function htmlResponse(res, body, status) {
  res.writeHead(status ?? 200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function jsonResponse(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function requestHandler(req, res) {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  const break_ = reqUrl.searchParams.get('break') || DEFAULT_BREAK;
  const transport = reqUrl.searchParams.get('transport') === 'tus' ? 'tus' : 'multipart';
  const seed = reqUrl.searchParams.get('seed') || 'demo';
  const autostart = reqUrl.searchParams.get('autostart') === '1' || seed === 'refused';

  // Synthetic upload endpoints (never actually accept payload; the
  // client-side loop simulates the wire). The endpoints exist so a
  // curl round-trip can prove the fixture is up.
  if (req.method === 'POST' && reqUrl.pathname === '/upload/chunk') {
    return jsonResponse(res, 200, { ok: true, chunk: reqUrl.searchParams.get('n') });
  }
  if (req.method === 'PATCH' && reqUrl.pathname === '/upload/tus') {
    res.writeHead(204, { 'Upload-Offset': req.headers['upload-offset'] || '0' });
    return res.end();
  }
  if (req.method !== 'GET') {
    return jsonResponse(res, 405, { error: 'method not allowed' });
  }
  const path = reqUrl.pathname;
  switch (path) {
    case '/':
      return htmlResponse(res, indexPage(), 200);
    case '/upload':
      return htmlResponse(res, uploadPage({ transport, break_, seed, autostart }), 200);
    default:
      return htmlResponse(res, indexPage(), 404);
  }
}

export function startServer({ port } = {}) {
  const server = http.createServer(requestHandler);
  return new Promise((resolve) => {
    server.listen(port ?? 0, () => {
      const addr = server.address();
      const boundPort = typeof addr === 'object' && addr ? addr.port : port;
      resolve({ server, port: boundPort });
    });
  });
}

const isDirect = import.meta.url === `file://${process.argv[1]}`;
if (isDirect) {
  const port = Number(process.env.PORT ?? 3000);
  if (port === 4200) {
    process.stderr.write('refusing to bind port 4200 (reserved for the operator workspace)\n');
    process.exit(2);
  }
  startServer({ port }).then(({ port: boundPort }) => {
    process.stdout.write(`LISTENING ${boundPort}\n`);
  });
}
