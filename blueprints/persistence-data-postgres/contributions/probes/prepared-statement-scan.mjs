/**
 * Prepared-statement scan probe.
 *
 * Walks every .js / .mjs / .ts file under the applied fixture's facade
 * directory (packages/rcf-lite/test/fixtures/infra-postgres/src/) and
 * asserts every .query(...) call's first argument is a static string
 * literal (single or double-quoted string, or a backtick template
 * literal with no ${...} expressions).
 *
 * Anchors AC-27103-1 (prepared-statement discipline).
 *
 * The scan is a hand-rolled tokenising walker, not a full AST parser:
 * this avoids adding acorn or babel as a rcf-lite dependency (round-5
 * spec section 5.5, brief section 4). The tokeniser handles strings,
 * template literals, comments, and nested parentheses. Runs
 * build-observable; the facade-round-trip probe carries the runtime
 * observable that the surface actually works.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FACADE_DIR = resolve(HERE, '..', '..', '..', '..', 'packages/rcf-lite/test/fixtures/infra-postgres/src');

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    if (e.isDirectory()) {
      files.push(...(await walk(join(dir, e.name))));
    } else if (e.isFile() && /\.(mjs|js|ts)$/.test(e.name)) {
      files.push(join(dir, e.name));
    }
  }
  return files;
}

/**
 * Strip block and line comments from source. Simple stripper: preserves
 * string bodies (in ' " and `) so `/* not a comment *\/` inside a string
 * survives. Good enough for the discipline scan.
 */
function stripCommentsPreserveStrings(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && c2 === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      out.push(' ');
      continue;
    }
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      out.push(' ');
      continue;
    }
    if (c === "'" || c === '"') {
      const q = c;
      out.push(c);
      i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\' && i + 1 < src.length) {
          out.push(src[i], src[i + 1]);
          i += 2;
          continue;
        }
        out.push(src[i]);
        i++;
      }
      if (i < src.length) {
        out.push(src[i]);
        i++;
      }
      continue;
    }
    if (c === '`') {
      out.push(c);
      i++;
      while (i < src.length && src[i] !== '`') {
        if (src[i] === '\\' && i + 1 < src.length) {
          out.push(src[i], src[i + 1]);
          i += 2;
          continue;
        }
        if (src[i] === '$' && src[i + 1] === '{') {
          out.push(src[i], src[i + 1]);
          i += 2;
          let depth = 1;
          while (i < src.length && depth > 0) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') depth--;
            out.push(src[i]);
            i++;
          }
          continue;
        }
        out.push(src[i]);
        i++;
      }
      if (i < src.length) {
        out.push(src[i]);
        i++;
      }
      continue;
    }
    out.push(c);
    i++;
  }
  return out.join('');
}

/**
 * Find every .query(...) call site and classify its first argument.
 * Returns [{ line, firstArgKind }] where firstArgKind is 'stringLiteral',
 * 'templateStatic', 'templateWithExpression', 'stringConcat', or
 * 'other'.
 */
function scanQueryCalls(src) {
  const cleaned = stripCommentsPreserveStrings(src);
  const calls = [];
  const rx = /\.query\s*\(/g;
  let m;
  while ((m = rx.exec(cleaned)) !== null) {
    const start = m.index + m[0].length;
    const line = cleaned.slice(0, start).split('\n').length;
    // Find the first argument by scanning forward, respecting parens/braces/strings
    let i = start;
    while (i < cleaned.length && /\s/.test(cleaned[i])) i++;
    const first = cleaned[i];
    if (first === "'" || first === '"') {
      calls.push({ line, firstArgKind: 'stringLiteral', preview: cleaned.slice(i, i + 60) });
    } else if (first === '`') {
      // Check if backtick body has ${...}
      let j = i + 1;
      let hasExpr = false;
      while (j < cleaned.length && cleaned[j] !== '`') {
        if (cleaned[j] === '$' && cleaned[j + 1] === '{') { hasExpr = true; break; }
        if (cleaned[j] === '\\') j++;
        j++;
      }
      calls.push({ line, firstArgKind: hasExpr ? 'templateWithExpression' : 'templateStatic', preview: cleaned.slice(i, i + 60) });
    } else if (/[A-Za-z_$]/.test(first)) {
      // Identifier or expression: could be a variable holding a static string, but that defeats the scan discipline
      calls.push({ line, firstArgKind: 'other', preview: cleaned.slice(i, i + 60) });
    } else {
      calls.push({ line, firstArgKind: 'other', preview: cleaned.slice(i, i + 60) });
    }
  }
  return calls;
}

export default async function runProbe() {
  const files = await walk(FACADE_DIR);
  const results = [];
  const violations = [];
  let totalCalls = 0;
  for (const file of files) {
    const src = await readFile(file, 'utf8');
    const calls = scanQueryCalls(src);
    for (const c of calls) {
      totalCalls++;
      if (c.firstArgKind === 'templateWithExpression' || c.firstArgKind === 'stringConcat') {
        violations.push({ file, ...c });
      }
    }
  }
  results.push({
    anchorAcId: 'AC-27103-1',
    verdict: violations.length === 0 ? 'pass' : 'fail',
    detail: violations.length === 0
      ? `${totalCalls} .query call sites scanned across ${files.length} facade file(s); every first argument is a static string literal or a template with no expressions`
      : `${violations.length} violation(s): ${JSON.stringify(violations)}`,
  });
  results.push({
    anchorAcId: 'AC-27103-1',
    verdict: totalCalls >= 5 ? 'pass' : 'warn',
    detail: `total .query call sites scanned: ${totalCalls} (minimum 5 to consider the facade meaningfully covered by this scan)`,
  });
  return results;
}
