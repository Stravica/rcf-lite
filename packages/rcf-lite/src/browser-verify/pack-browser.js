// packBrowser: a real headless browser exposed to blueprint-shipped
// probe packs (visual-round-spec-2026-09-04 §3.3). The browser is
// provisioned through the pinned Playwright MCP server as a JSON-RPC
// 2.0 stdio client, with an optional cheaper route via a `playwright`
// installation already resolved from the consuming project's own
// node_modules. Both routes expose the same small stable API:
//
//   goto(url)                  navigate to a URL
//   snapshot()                 accessibility-tree text (searchable)
//   evaluate(fn, arg?)         run JS in page context; returns parsed value
//   click(selectorOrRef, hint) click an element by CSS selector or a11y ref
//   type(selectorOrRef, text)  type into an editable element
//   press(key)                 press a keyboard key
//   screenshot(filename?)      capture a PNG; returns descriptor / path
//   close()                    close the page + terminate the browser process
//
// Zero new npm dependencies: MCP over stdio uses only Node built-ins;
// the cheap route uses `playwright` peer dep if the project already
// installed it. No LLM call anywhere.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve as resolvePath } from 'node:path';

import { PLAYWRIGHT_MCP_VERSION } from '../verify/engine/launcher.js';

const DEFAULT_TOOL_TIMEOUT_MS = 30000;
const INIT_TIMEOUT_MS = 45000;

/**
 * Compose a packBrowser for use by probe packs.
 *
 * @param {object} [options]
 * @param {string} [options.projectRoot]           consuming project root; used to try the cheap route
 * @param {string} [options.playwrightMcpVersion]  pinned MCP semver (defaults to PLAYWRIGHT_MCP_VERSION)
 * @param {'auto'|'mcp'|'project'} [options.route] force a route (default 'auto')
 * @param {(line: string) => void} [options.logger]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {number} [options.timeoutMs]             per-RPC timeout
 * @returns {Promise<object>}                      the packBrowser handle
 */
export async function createPackBrowser(options = {}) {
  const {
    projectRoot,
    playwrightMcpVersion = PLAYWRIGHT_MCP_VERSION,
    route = 'auto',
    logger = () => {},
    env = process.env,
    timeoutMs = DEFAULT_TOOL_TIMEOUT_MS,
  } = options;

  if (route === 'project' || (route === 'auto' && projectRoot && await tryResolveProjectPlaywright(projectRoot))) {
    const handle = await createProjectPlaywrightHandle({ projectRoot, logger });
    if (handle) return handle;
    if (route === 'project') throw new Error(`packBrowser: project route requested but 'playwright' is not installed under ${projectRoot}`);
  }
  return createMcpPackBrowser({ playwrightMcpVersion, logger, env, timeoutMs });
}

async function tryResolveProjectPlaywright(projectRoot) {
  try {
    const req = createRequire(resolvePath(projectRoot, 'package.json'));
    req.resolve('playwright');
    return true;
  } catch {
    return false;
  }
}

async function createProjectPlaywrightHandle({ projectRoot, logger }) {
  try {
    const req = createRequire(resolvePath(projectRoot, 'package.json'));
    const playwrightPath = req.resolve('playwright');
    const mod = await import(pathToFileURL(playwrightPath).href);
    const chromium = mod?.chromium ?? mod?.default?.chromium;
    if (!chromium) return null;
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    return Object.freeze({
      provisioning: { via: 'project-playwright', playwrightPath },
      async goto(url) { await page.goto(url, { waitUntil: 'load' }); },
      async snapshot() {
        const tree = await page.accessibility.snapshot({ interestingOnly: false });
        return renderA11yTree(tree);
      },
      async evaluate(fn, arg) {
        if (typeof fn === 'function') return page.evaluate(fn, arg);
        return page.evaluate(String(fn));
      },
      async click(selector) { await page.click(selector); },
      async type(selector, text) { await page.fill(selector, text); },
      async press(key) { await page.keyboard.press(key); },
      async screenshot(filename) {
        const target = filename ? { path: filename } : undefined;
        const buf = await page.screenshot(target);
        return filename ?? `data:image/png;base64,${buf.toString('base64')}`;
      },
      async close() {
        logger('[pack-browser] closing project-playwright browser');
        try { await page.close(); } catch { /* fine */ }
        try { await context.close(); } catch { /* fine */ }
        try { await browser.close(); } catch { /* fine */ }
      },
    });
  } catch (err) {
    logger(`[pack-browser] project-playwright route failed: ${err.message}`);
    return null;
  }
}

function renderA11yTree(node, depth = 0) {
  if (!node) return '';
  const pad = '  '.repeat(depth);
  const parts = [];
  parts.push(`${pad}${node.role ?? '?'} ${node.name ? JSON.stringify(node.name) : ''}`.trimEnd());
  for (const child of node.children ?? []) parts.push(renderA11yTree(child, depth + 1));
  return parts.join('\n');
}

async function createMcpPackBrowser({ playwrightMcpVersion, logger, env, timeoutMs }) {
  const child = spawn('npx', ['-y', `@playwright/mcp@${playwrightMcpVersion}`, '--headless', '--isolated'], {
    env: { ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  /** @type {Map<number, { resolve: (v: any) => void, reject: (e: Error) => void, timer: NodeJS.Timeout|null }>} */
  const pending = new Map();
  let nextId = 1;
  let buffer = '';
  let exited = false;

  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    for (;;) {
      const nl = buffer.indexOf('\n');
      if (nl === -1) break;
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id != null && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        if (p.timer) clearTimeout(p.timer);
        if (msg.error) p.reject(new Error(msg.error.message ?? `MCP error ${JSON.stringify(msg.error)}`));
        else p.resolve(msg.result);
      }
    }
  });
  child.stderr.on('data', (chunk) => logger(`[playwright-mcp] ${chunk.toString('utf8').trimEnd()}`));
  child.on('exit', (code) => {
    exited = true;
    for (const [, p] of pending) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(new Error(`Playwright MCP exited (code=${code})`));
    }
    pending.clear();
  });

  function rpc(method, params, { timeout = timeoutMs } = {}) {
    if (exited) return Promise.reject(new Error('Playwright MCP process already exited'));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`MCP method ${method} timed out after ${timeout}ms`));
        }
      }, timeout);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  async function tool(name, args) {
    const result = await rpc('tools/call', { name, arguments: args ?? {} });
    if (result?.isError) {
      const text = textOf(result);
      throw new Error(`Playwright MCP ${name} failed: ${text || JSON.stringify(result)}`);
    }
    return result;
  }

  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'rcf-lite-pack-browser', version: '0.0.0' },
  }, { timeout: INIT_TIMEOUT_MS });
  // Best-effort initialized notification (some servers ignore, that is fine).
  try {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  } catch { /* fine */ }

  return Object.freeze({
    provisioning: { via: 'playwright-mcp', version: playwrightMcpVersion },
    async goto(url) {
      await tool('browser_navigate', { url });
    },
    async snapshot() {
      return textOf(await tool('browser_snapshot', {}));
    },
    async evaluate(fn, arg) {
      const src = composeEvaluateSource(fn, arg);
      const text = textOf(await tool('browser_evaluate', { function: src }));
      return parseEvaluateResult(text);
    },
    async click(selector, hint) {
      await tool('browser_click', { target: selector, element: hint ?? selector });
    },
    async type(selector, text, hint) {
      await tool('browser_type', { target: selector, text, element: hint ?? selector });
    },
    async press(key) {
      await tool('browser_press_key', { key });
    },
    async screenshot(filename) {
      const args = filename ? { filename } : {};
      return textOf(await tool('browser_take_screenshot', args));
    },
    async close() {
      logger('[pack-browser] closing playwright-mcp browser');
      try { await tool('browser_close', {}); } catch { /* fine */ }
      try { child.stdin.end(); } catch { /* fine */ }
      await new Promise((resolve) => {
        if (exited) return resolve();
        const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* fine */ } resolve(); }, 5000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
      });
    },
  });
}

function textOf(result) {
  const parts = Array.isArray(result?.content) ? result.content : [];
  return parts.map((c) => (c?.type === 'text' ? (c.text ?? '') : '')).join('\n');
}

function composeEvaluateSource(fn, arg) {
  if (typeof fn !== 'function') return String(fn);
  if (arg === undefined) return fn.toString();
  return `() => (${fn.toString()})(${JSON.stringify(arg)})`;
}

/**
 * The MCP browser_evaluate response is a human-readable text block, usually of
 * the shape "- Ran Playwright code:\n... - Result: <json-ish>". Parse the trailing
 * value out of it and JSON-parse when possible. Exported for unit tests.
 */
export function parseEvaluateResult(text) {
  if (typeof text !== 'string') return text;
  // MCP 0.0.80+ returns "### Result\n<value>\n### Ran Playwright code\n```js..."
  const headed = text.match(/###\s*Result\s*\n([\s\S]*?)(?=\n###\s|\n?$)/);
  if (headed) {
    const inner = headed[1].trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    try { return JSON.parse(inner); } catch { return inner; }
  }
  // Older MCP shape: "Result: <value>" trailing block.
  const marker = text.lastIndexOf('Result:');
  const tail = marker >= 0 ? text.slice(marker + 'Result:'.length).trim() : text.trim();
  const stripped = tail.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(stripped); } catch { return stripped; }
}
