/**
 * A one-page preview server: GET /?title=<text> shows the slug the title gets.
 * Run it with `node src/preview-server.ts` (Node strips the types).
 */

import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';

import { slugify } from './slug.ts';

export const NOTHING_TO_PREVIEW = 'Nothing to preview yet.';

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The preview page for a submitted title, or for no title at all (null). */
export function renderPreviewPage(title: string | null): string {
  const slug = title === null ? '' : slugify(title);
  const result = slug === ''
    ? `<p id="empty">${NOTHING_TO_PREVIEW}</p>`
    : `<p>Slug: <output id="slug">${slug}</output></p>`;
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head><meta charset="utf-8"><title>Slug preview</title></head>',
    '<body>',
    '<h1>Slug preview</h1>',
    '<form method="get" action="/">',
    `<label for="title">Title</label> <input id="title" name="title" value="${escapeHtml(title ?? '')}">`,
    '<button type="submit">Preview</button>',
    '</form>',
    result,
    '</body>',
    '</html>',
  ].join('\n');
}

/** The HTTP server for the preview page; not yet listening. */
export function createPreviewServer(): Server {
  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method !== 'GET' || url.pathname !== '/') {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(renderPreviewPage(url.searchParams.get('title')));
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PREVIEW_PORT ?? 47613);
  createPreviewServer().listen(port, '127.0.0.1');
}
