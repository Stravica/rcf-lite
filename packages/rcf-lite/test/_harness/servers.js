// Shared test harness (GR-40): the two long-running entry points of
// bin/rcf.js, driven from a test and always stopped. viewerPage starts the
// viewer (rcf audit view) on a free loopback port, fetches one page and
// stops the server; mcpCall starts the stdio MCP server (rcf mcp), calls
// one tool and stops the server. Each stops its child on pass and on
// failure. Imports Node builtins and the harness only.

import { spawn } from 'node:child_process';

import { BIN, baseEnv } from './spawn.js';

function start(args, cwd, stdin) {
  const child = spawn(process.execPath, [BIN, ...args], { cwd, env: baseEnv(), stdio: [stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
  const out = { stdout: '', stderr: '' };
  child.stdout.on('data', (b) => { out.stdout += b.toString(); });
  child.stderr.on('data', (b) => { out.stderr += b.toString(); });
  const exited = new Promise((res) => child.once('exit', (code, signal) => res({ code, signal })));
  return { child, out, exited };
}

async function stop({ child, exited }, signal = 'SIGINT', budgetMs = 10_000) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill(signal);
  const timer = new Promise((res) => setTimeout(() => res('budget'), budgetMs));
  if ((await Promise.race([exited, timer])) === 'budget') {
    child.kill('SIGKILL');
    await exited;
  }
}

/**
 * Start rcf audit view --port 0 --no-open in cwd, fetch one page, stop the
 * server. Resolves { status, html, stdout, stderr }.
 */
export async function viewerPage(cwd, path = '/', { readyMs = 30_000 } = {}) {
  const s = start(['audit', 'view', '--port', '0', '--no-open'], cwd, false);
  try {
    const deadline = Date.now() + readyMs;
    let m = null;
    while (!(m = /listening at (http:\/\/[\d.]+:\d+)\//.exec(s.out.stdout))) {
      if (s.child.exitCode !== null || Date.now() > deadline) throw new Error(`harness: the viewer did not listen (exit ${s.child.exitCode})\nstdout:\n${s.out.stdout}\nstderr:\n${s.out.stderr}`);
      await new Promise((r) => setTimeout(r, 50));
    }
    const res = await fetch(`${m[1]}${path}`);
    return { status: res.status, html: await res.text(), stdout: s.out.stdout, stderr: s.out.stderr };
  } finally {
    await stop(s);
  }
}

/**
 * Start rcf mcp in cwd over stdio, initialize, call one tool with args,
 * stop the server. Resolves the tools/call result ({ content,
 * structuredContent, isError }) or throws on a JSON-RPC error.
 */
export async function mcpCall(cwd, name, args = {}, { replyMs = 60_000 } = {}) {
  const s = start(['mcp'], cwd, true);
  let buf = '';
  const waiting = new Map();
  s.child.stdout.on('data', (b) => {
    buf += b.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id !== undefined && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
    }
  });
  const request = (id, method, params) => new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error(`harness: no MCP reply to ${method} in ${replyMs} ms\nstderr:\n${s.out.stderr}`)), replyMs);
    waiting.set(id, (msg) => { clearTimeout(timer); res(msg); });
    s.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  try {
    const init = await request(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'rcf-test-harness', version: '0' } });
    if (init.error) throw new Error(`harness: MCP initialize failed: ${JSON.stringify(init.error)}`);
    s.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const reply = await request(2, 'tools/call', { name, arguments: args });
    if (reply.error) throw new Error(`harness: MCP tools/call ${name} failed: ${JSON.stringify(reply.error)}`);
    return reply.result;
  } finally {
    s.child.stdin.end();
    await stop(s, 'SIGTERM');
  }
}
