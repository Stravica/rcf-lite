// Round-7 T-2 fixture web service stub. Terminates HTTP on WEB_LISTEN_PORT
// (default 8080), returns 200 ok on WEB_HEALTH_PATH (default /live) so the
// compose healthcheck reaches healthy. Never reads process.env for the
// mounted secret directly; the secret arrives as a file mount at
// /run/secrets/web-token per REQ-121.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const port = Number(process.env.WEB_LISTEN_PORT ?? 8080);
const healthPath = process.env.WEB_HEALTH_PATH ?? '/live';
async function readTokenPresence() {
  try {
    const stat = await readFile('/run/secrets/web-token', 'utf8');
    return stat.length > 0 ? 'present' : 'empty';
  } catch (err) {
    return 'absent';
  }
}
const server = createServer(async (req, res) => {
  if (req.url === healthPath) {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  const present = await readTokenPresence();
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ appName: process.env.WEB_APP_NAME ?? 'unknown', tokenPresence: present }));
});
server.listen(port, () => {
  process.stdout.write(`serve.mjs listening on ${port}, health at ${healthPath}\n`);
});
