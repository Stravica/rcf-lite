// Minimal SMTP catch-all fixture for email-smtp-resend probes.
//
// Realises a low-level SMTP responder that accepts EHLO/MAIL/RCPT/
// DATA/QUIT and records every envelope + message body. Enough SMTP
// for the shape probe: prove the adapter dials, negotiates, and
// hands over the message. Never speaks TLS; every probe binds on
// 127.0.0.1 only.

import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';

export function createCatchAllSmtp() {
  const messages = [];
  let unverifiedSenderMode = false;
  const server = createServer((sock) => {
    const messageId = randomUUID();
    let state = 'connected';
    const envelope = { from: null, to: [], data: [] };
    let dataMode = false;
    sock.setEncoding('utf8');
    sock.write(`220 catch-all.local ESMTP ready ${messageId}\r\n`);
    let buf = '';
    sock.on('data', (chunk) => {
      buf += chunk;
      while (true) {
        const nl = buf.indexOf('\r\n');
        if (nl < 0) break;
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        if (dataMode) {
          if (line === '.') {
            dataMode = false;
            messages.push({ ...envelope, id: messageId, dataText: envelope.data.join('\r\n') });
            sock.write(`250 2.0.0 Ok: queued as ${messageId}\r\n`);
          } else {
            envelope.data.push(line);
          }
          continue;
        }
        if (/^EHLO /i.test(line)) { sock.write(`250-catch-all.local\r\n250 SIZE 10485760\r\n`); state = 'ehlo'; continue; }
        if (/^HELO /i.test(line)) { sock.write(`250 catch-all.local\r\n`); state = 'ehlo'; continue; }
        if (/^MAIL FROM:/i.test(line)) {
          const addr = line.match(/<([^>]*)>/)?.[1] || '';
          if (unverifiedSenderMode && !addr.endsWith('@verified.example')) {
            sock.write(`550 5.7.1 Sender address rejected: not verified\r\n`);
            continue;
          }
          envelope.from = addr;
          sock.write(`250 2.1.0 Ok\r\n`);
          continue;
        }
        if (/^RCPT TO:/i.test(line)) { envelope.to.push(line.match(/<([^>]*)>/)?.[1] || ''); sock.write(`250 2.1.5 Ok\r\n`); continue; }
        if (/^DATA/i.test(line)) { dataMode = true; sock.write(`354 End data with <CR><LF>.<CR><LF>\r\n`); continue; }
        if (/^QUIT/i.test(line)) { sock.write(`221 2.0.0 Bye\r\n`); sock.end(); continue; }
        if (/^NOOP/i.test(line)) { sock.write(`250 2.0.0 Ok\r\n`); continue; }
        sock.write(`502 5.5.2 Unrecognised command\r\n`);
      }
    });
    sock.on('error', () => {});
  });
  return {
    server,
    messages,
    setUnverifiedSenderMode(flag) { unverifiedSenderMode = flag; },
    async listen(port) {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => resolve()); });
      return { port: server.address().port };
    },
    async close() {
      // Teardown propagates errors on close.
      await new Promise((resolve, reject) => {
        server.close((err) => { if (err) reject(err); else resolve(); });
      });
    },
  };
}

// Minimal SMTP dialler enough for the probes (RFC5321 subset).
export async function sendViaSmtp({ host, port, from, to, subject, body }) {
  const { Socket } = await import('node:net');
  const sock = new Socket();
  const messages = [];
  return await new Promise((resolve, reject) => {
    let state = 'greet';
    let buf = '';
    let final = null;
    sock.setEncoding('utf8');
    sock.connect(port, host);
    sock.on('data', (chunk) => {
      buf += chunk;
      while (true) {
        const nl = buf.indexOf('\r\n');
        if (nl < 0) break;
        const line = buf.slice(0, nl); buf = buf.slice(nl + 2);
        messages.push(line);
        if (state === 'greet' && /^220 /.test(line)) { state = 'ehlo'; sock.write('EHLO probe.local\r\n'); }
        else if (state === 'ehlo' && /^250 /.test(line)) { state = 'mail'; sock.write(`MAIL FROM:<${from}>\r\n`); }
        else if (state === 'mail' && /^250 /.test(line)) { state = 'rcpt'; sock.write(`RCPT TO:<${to}>\r\n`); }
        else if (state === 'mail' && /^5\d\d /.test(line)) { final = { ok: false, code: Number(line.slice(0, 3)), lastLine: line, transcript: messages }; sock.write('QUIT\r\n'); state = 'quitting'; }
        else if (state === 'rcpt' && /^250 /.test(line)) { state = 'data'; sock.write('DATA\r\n'); }
        else if (state === 'data' && /^354 /.test(line)) { state = 'body'; sock.write(`Subject: ${subject}\r\nFrom: ${from}\r\nTo: ${to}\r\n\r\n${body}\r\n.\r\n`); }
        else if (state === 'body' && /^250 /.test(line)) { final = { ok: true, code: 250, lastLine: line, transcript: messages }; sock.write('QUIT\r\n'); state = 'quitting'; }
        else if (state === 'quitting' && /^221 /.test(line)) { /* wait for close */ }
      }
    });
    sock.on('end', () => resolve(final || { ok: false, transcript: messages }));
    sock.on('error', (e) => reject(e));
  });
}
