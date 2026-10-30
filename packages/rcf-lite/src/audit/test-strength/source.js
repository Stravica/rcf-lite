// JavaScript source reading for `rcf audit test-strength` (FBS-236,
// TAC-4155, ADR-4156). A small tokenizer for ES modules and CommonJS
// (.js, .mjs, .cjs) that is aware of strings, template literals,
// comments, regular expression literals and bracket pairs, plus the
// structural reads the verb needs over its tokens: import and mock
// specifiers, top-level declarations (functions, classes and their
// methods, function-valued initialisers), parameter lists and
// statement-level call sites.
//
// No parser dependency: the package carries none, and the verb needs
// only declaration and statement boundaries, which bracket matching over
// tokens gives. Source is read as text and never evaluated.
//
// TypeScript, JSX and Vue files (FBS-242, US-19904) are read through a
// view of the same length as the file: node:module's
// stripTypeScriptTypes in strip mode for .ts, .mts and .cts (types
// become spaces), the JSX scanner for .tsx and .jsx, and for .vue the
// SFC's <script> and <script setup> blocks in place with everything
// else blanked. Offsets hold, so rewrites found in the view are spliced
// into the original file. What a view cannot read is reported with its
// position, never guessed.

import { stripTypeScriptTypes } from 'node:module';
import { extname } from 'node:path';

import { blankJsx } from './jsx.js';

// Multi-character punctuators, longest first.
const PUNCT = ['>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=', '=>', '==', '!=',
  '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**', '<<', '>>'];
// Keywords after which a "/" starts a regular expression literal.
const REGEX_AFTER = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case',
  'do', 'else', 'yield', 'await']);
// Keywords that are operators: an expression never ends on one, and a
// line starting with one continues the line before it.
const OPERATOR_WORDS = new Set(['typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'await', 'yield']);
const ID_START = /[A-Za-z_$\u0080-\uffff]/;
const ID_PART = /[\w$\u0080-\uffff]/;
const OPENERS = { '(': ')', '[': ']', '{': '}' };
const CLOSERS = new Set([')', ']', '}']);

/**
 * Skip a template literal from just after its opening backtick (`at`).
 * `${...}` expressions are read with the tokenizer itself, so strings and
 * braces inside them are safe, and their tokens are kept as `inner`
 * ({ start, end, tokens } per expression). Returns { end, inner, open }:
 * end the index after the closing backtick; open, when the input ends
 * inside the template, where the innermost construct still open opens.
 */
function skipTemplate(text, at) {
  const inner = [];
  let i = at;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') { i += 2; continue; }
    if (ch === '`') return { end: i + 1, inner };
    if (ch === '$' && text[i + 1] === '{') {
      const r = lex(text, i + 2, true);
      inner.push({ start: i + 2, end: r.closed ? r.end - 1 : r.end, tokens: r.tokens });
      if (!r.closed) {
        const brackets = pairBrackets(r.tokens).open;
        return { end: text.length, inner, open: r.open ?? (brackets.length ? r.tokens[brackets[brackets.length - 1]].start : at - 1) };
      }
      i = r.end;
      continue;
    }
    i += 1;
  }
  return { end: text.length, inner, open: at - 1 };
}

function regexAllowed(prev) {
  if (!prev) return true;
  if (prev.type === 'punct') return !(prev.text === ')' || prev.text === ']' || prev.text === '++' || prev.text === '--');
  if (prev.type === 'id') return REGEX_AFTER.has(prev.text);
  return false;
}

/**
 * Tokenize from `start`. With `nested` (a template expression) it stops
 * at the first unmatched "}" and returns the index after it (closed).
 * A template token carries the tokens of its expressions (`inner`).
 * When the input ends inside a block comment, a string or a template
 * literal, `open` is where the innermost construct still open opens.
 *
 * @returns {{ tokens: Array<{ type: string, text: string, start: number, end: number, nl: boolean, inner?: object[] }>, end: number, closed?: boolean, open?: number }}
 */
function lex(text, start, nested) {
  const tokens = [];
  const n = text.length;
  let i = start;
  let nl = false;
  let depth = 0;
  let open;
  if (!nested && i === 0 && text.startsWith('#!')) {
    while (i < n && text[i] !== '\n') i += 1;
  }
  while (i < n) {
    const c = text[i];
    if (c === '\n' || c === '\r' || c === '\u2028' || c === '\u2029') { nl = true; i += 1; continue; }
    if (c === ' ' || c === '\t' || c === '\f' || c === '\v' || c === '\u00a0' || c === '\ufeff') { i += 1; continue; }
    if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n' && text[i] !== '\r') i += 1;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      const end = close < 0 ? n : close + 2;
      if (close < 0) open = i;
      if (/[\n\r\u2028\u2029]/.test(text.slice(i, end))) nl = true;
      i = end;
      continue;
    }
    const s = i;
    let type;
    let inner;
    if (c === '"' || c === "'") {
      i += 1;
      while (i < n && text[i] !== c && text[i] !== '\n') i += text[i] === '\\' ? 2 : 1;
      if (i >= n) open = s;
      i += 1;
      type = 'str';
    } else if (c === '`') {
      const r = skipTemplate(text, i + 1);
      i = r.end;
      if (r.open !== undefined) open = r.open;
      type = 'tpl';
      inner = r.inner;
    } else if (ID_START.test(c) || (c === '#' && ID_START.test(text[i + 1] ?? ''))) {
      i += 1;
      while (i < n && ID_PART.test(text[i])) i += 1;
      type = 'id';
    } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(text[i + 1] ?? ''))) {
      const hex = c === '0' && /[xXbBoO]/.test(text[i + 1] ?? '');
      i += 1;
      while (i < n && /[\w.]/.test(text[i])) {
        if (!hex && (text[i] === 'e' || text[i] === 'E') && (text[i + 1] === '+' || text[i + 1] === '-')) i += 2;
        else i += 1;
      }
      type = 'num';
    } else if (c === '/' && regexAllowed(tokens[tokens.length - 1])) {
      i += 1;
      let inClass = false;
      while (i < n && text[i] !== '\n') {
        const ch = text[i];
        if (ch === '\\') { i += 2; continue; }
        if (inClass) { if (ch === ']') inClass = false; } else if (ch === '[') inClass = true; else if (ch === '/') { i += 1; break; }
        i += 1;
      }
      while (i < n && ID_PART.test(text[i])) i += 1;
      type = 'regex';
    } else {
      const multi = PUNCT.find((p) => text.startsWith(p, i) && !(p === '?.' && /[0-9]/.test(text[i + 2] ?? '')));
      i += multi ? multi.length : 1;
      type = 'punct';
      if (nested) {
        if (c === '{') depth += 1;
        if (c === '}') {
          if (depth === 0) return { tokens, end: i, closed: true };
          depth -= 1;
        }
      }
    }
    tokens.push(inner ? { type, text: text.slice(s, i), start: s, end: i, nl, inner } : { type, text: text.slice(s, i), start: s, end: i, nl });
    nl = false;
  }
  return { tokens, end: n, closed: false, open };
}

/**
 * Pair the brackets of a token list: each bracket's partner (`match`),
 * each token's bracket depth (`depth`), and the openers still unmatched
 * at the end (`open`, token indices, innermost last).
 */
function pairBrackets(tokens) {
  const match = new Array(tokens.length).fill(-1);
  const depth = new Array(tokens.length).fill(0);
  const stack = [];
  tokens.forEach((t, i) => {
    depth[i] = stack.length;
    if (t.type !== 'punct') return;
    if (t.text in OPENERS) { stack.push(i); return; }
    if (CLOSERS.has(t.text) && stack.length && OPENERS[tokens[stack[stack.length - 1]].text] === t.text) {
      const o = stack.pop();
      match[o] = i;
      match[i] = o;
      depth[i] = stack.length;
    }
  });
  return { match, depth, open: stack };
}

/**
 * Tokenize one source file, with each bracket's partner (`match`) and
 * each token's bracket depth (`depth`).
 *
 * @param {string} text
 */
export function parseSource(text) {
  const { tokens } = lex(text, 0, false);
  const { match, depth } = pairBrackets(tokens);
  return { text, tokens, match, depth };
}

/** The string value of a quoted string token (escapes are left as written). */
export function stringValue(tok) {
  return tok && tok.type === 'str' ? tok.text.slice(1, -1) : null;
}

const is = (tok, type, text) => Boolean(tok) && tok.type === type && (text === undefined || tok.text === text);
const punct = (tok, text) => is(tok, 'punct', text);
const word = (tok, text) => is(tok, 'id', text);

/** True when an expression can end on this token. */
function endsExpression(tok) {
  if (!tok) return false;
  if (tok.type === 'id') return !OPERATOR_WORDS.has(tok.text);
  if (tok.type === 'punct') return [')', ']', '}', '++', '--'].includes(tok.text);
  return true;
}

/** True when a token at the start of a line begins a new statement (ASI). */
function beginsStatement(tok) {
  if (!tok) return true;
  if (tok.type === 'id') return !OPERATOR_WORDS.has(tok.text) || tok.text === 'await' || tok.text === 'new';
  if (tok.type === 'num' || tok.type === 'str') return true;
  if (tok.type === 'punct') return ['{', '!', '~', '++', '--'].includes(tok.text);
  return false;
}

/**
 * The end (exclusive token index) of the expression starting at `from`:
 * the first ",", ";" or unmatched closer at its own level, or a line
 * break where automatic semicolon insertion ends the statement.
 */
function expressionEnd(src, from, limit = src.tokens.length) {
  const { tokens, match } = src;
  let k = from;
  while (k < limit) {
    const t = tokens[k];
    if (k > from && t.nl && endsExpression(tokens[k - 1]) && beginsStatement(t)) return k;
    if (t.type === 'punct') {
      if (t.text === ',' || t.text === ';' || CLOSERS.has(t.text)) return k;
      if (t.text in OPENERS) {
        if (match[k] < 0) return limit;
        k = match[k] + 1;
        continue;
      }
    }
    k += 1;
  }
  return limit;
}

/**
 * Read a function-valued expression from token `at` to `end`: a function
 * expression, an arrow function (block or concise body) or a class
 * expression. Null for any other value.
 */
function functionValue(src, at, end) {
  const { tokens, match } = src;
  let k = at;
  if (word(tokens[k], 'async') && k + 1 < end && !tokens[k + 1].nl) k += 1;
  const t = tokens[k];
  if (word(t, 'function')) {
    k += 1;
    if (punct(tokens[k], '*')) k += 1;
    if (is(tokens[k], 'id')) k += 1;
    if (!punct(tokens[k], '(') || match[k] < 0) return null;
    const body = match[k] + 1;
    if (!punct(tokens[body], '{') || match[body] < 0) return null;
    return { kind: 'function', params: [k, match[k]], body: [body, match[body]] };
  }
  if (word(t, 'class')) return classAt(src, k);
  let params = null;
  let arrow;
  if (punct(t, '(') && match[k] >= 0) { params = [k, match[k]]; arrow = match[k] + 1; } else if (is(t, 'id')) arrow = k + 1;
  else return null;
  if (!punct(tokens[arrow], '=>')) return null;
  const b = arrow + 1;
  if (punct(tokens[b], '{') && match[b] >= 0) return { kind: 'function', params, body: [b, match[b]] };
  if (b >= end) return null;
  return { kind: 'function', params, concise: [b, end] };
}

/** A class at the `class` keyword token: its methods and function-valued fields. */
function classAt(src, at) {
  const { tokens, match } = src;
  let k = at + 1;
  while (k < tokens.length && !punct(tokens[k], '{')) {
    if (punct(tokens[k], '(') || punct(tokens[k], '[')) { if (match[k] < 0) return null; k = match[k]; }
    k += 1;
  }
  if (k >= tokens.length || match[k] < 0) return null;
  const close = match[k];
  const methods = [];
  const MODIFIERS = new Set(['static', 'async', 'get', 'set', 'accessor']);
  let m = k + 1;
  while (m < close) {
    if (punct(tokens[m], ';')) { m += 1; continue; }
    if (word(tokens[m], 'static') && punct(tokens[m + 1], '{')) { m = match[m + 1] + 1; continue; }
    while (word(tokens[m], undefined) && MODIFIERS.has(tokens[m].text)
      && !['(', '=', ';', '}'].some((p) => punct(tokens[m + 1], p))) m += 1;
    if (punct(tokens[m], '*')) m += 1;
    let name = null;
    if (punct(tokens[m], '[')) { m = match[m] + 1; } else { name = tokens[m]?.text ?? null; m += 1; }
    if (name && /^["']/.test(name)) name = name.slice(1, -1);
    if (punct(tokens[m], '(') && match[m] >= 0) {
      const body = match[m] + 1;
      if (!punct(tokens[body], '{') || match[body] < 0) return null;
      methods.push({ name, kind: 'function', params: [m, match[m]], body: [body, match[body]], constructor: name === 'constructor' });
      m = match[body] + 1;
      continue;
    }
    if (punct(tokens[m], '=')) {
      const end = expressionEnd(src, m + 1, close);
      const fn = functionValue(src, m + 1, end);
      if (fn && fn.kind === 'function' && name) methods.push({ name, ...fn, constructor: false });
      m = end;
      continue;
    }
    if (m <= k) break;
  }
  return { kind: 'class', methods };
}

/**
 * The top-level declaration of `name` in a module: a function (a
 * declaration, or a const, let or var initialised with a function or
 * arrow), a class, or `other` for a binding of any other value. Null
 * when the module declares no such name (a re-export included).
 *
 * @param {ReturnType<typeof parseSource>} src
 * @param {string} name
 */
export function findDeclaration(src, name) {
  const { tokens, match, depth } = src;
  for (let i = 0; i < tokens.length; i += 1) {
    if (depth[i] !== 0) continue;
    const t = tokens[i];
    if (word(t, 'function')) {
      let k = i + 1;
      if (punct(tokens[k], '*')) k += 1;
      if (word(tokens[k], name) && punct(tokens[k + 1], '(') && match[k + 1] >= 0) {
        const body = match[k + 1] + 1;
        if (punct(tokens[body], '{') && match[body] >= 0) return { kind: 'function', params: [k + 1, match[k + 1]], body: [body, match[body]] };
      }
      continue;
    }
    if (word(t, 'class') && word(tokens[i + 1], name)) return classAt(src, i) ?? { kind: 'other' };
    if (word(t, 'const') || word(t, 'let') || word(t, 'var')) {
      let k = i + 1;
      while (k < tokens.length) {
        const binding = tokens[k];
        let next = k + 1;
        if ((punct(binding, '{') || punct(binding, '[')) && match[k] >= 0) next = match[k] + 1;
        if (!punct(tokens[next], '=')) break;
        const end = expressionEnd(src, next + 1);
        if (word(binding, name)) return functionValue(src, next + 1, end) ?? { kind: 'other' };
        if (!punct(tokens[end], ',')) break;
        k = end + 1;
      }
    }
  }
  return null;
}

/**
 * The names given a default value in a parameter list (token range
 * [open, close], the parentheses), each with the destructured key it
 * binds when that is a different name: `{ sender = x }` gives sender,
 * `{ log: out = x }` gives out and log, `logger = console` gives logger.
 *
 * @returns {Array<{ name: string, key: string|null }>}
 */
export function defaultedParams(src, [open, close]) {
  const { tokens } = src;
  const out = [];
  for (let k = open + 1; k < close; k += 1) {
    if (!punct(tokens[k], '=') || !is(tokens[k - 1], 'id')) continue;
    const key = punct(tokens[k - 2], ':') && is(tokens[k - 3], 'id') ? tokens[k - 3].text : null;
    out.push({ name: tokens[k - 1].text, key });
  }
  return out;
}

/**
 * Module specifiers a file names: static imports, export-from, dynamic
 * import() and require() of a string literal.
 *
 * @returns {string[]}
 */
export function importSpecifiers(src) {
  const { tokens } = src;
  const out = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (punct(tokens[i - 1], '.') || punct(tokens[i - 1], '?.')) continue;
    if (word(t, 'import')) {
      if (punct(tokens[i + 1], '(')) {
        if (is(tokens[i + 2], 'str')) out.push(stringValue(tokens[i + 2]));
        continue;
      }
      if (punct(tokens[i + 1], '.')) continue;
      if (is(tokens[i + 1], 'str')) { out.push(stringValue(tokens[i + 1])); continue; }
      for (let k = i + 1; k < tokens.length && !punct(tokens[k], ';'); k += 1) {
        if (word(tokens[k], 'from') && is(tokens[k + 1], 'str')) { out.push(stringValue(tokens[k + 1])); break; }
        if (k > i + 1 && tokens[k].nl && word(tokens[k], 'import')) break;
      }
      continue;
    }
    if (word(t, 'export') && (punct(tokens[i + 1], '*') || punct(tokens[i + 1], '{'))) {
      let k = i + 1;
      if (punct(tokens[k], '{')) k = src.match[k] + 1;
      for (; k < tokens.length && k <= i + 6 && !punct(tokens[k], ';'); k += 1) {
        if (word(tokens[k], 'from') && is(tokens[k + 1], 'str')) { out.push(stringValue(tokens[k + 1])); break; }
      }
      continue;
    }
    if (word(t, 'require') && punct(tokens[i + 1], '(') && is(tokens[i + 2], 'str') && punct(tokens[i + 3], ')')) {
      out.push(stringValue(tokens[i + 2]));
    }
  }
  return out;
}

/** Specifiers passed to mock.module(<string>, ...) (node:test module mocks) or vi.mock(<string>, ...) (vitest's). */
export function mockedModules(src) {
  const { tokens } = src;
  const out = [];
  for (let i = 0; i + 4 < tokens.length; i += 1) {
    const mock = (word(tokens[i], 'mock') && word(tokens[i + 2], 'module')) || (word(tokens[i], 'vi') && word(tokens[i + 2], 'mock'));
    if (mock && punct(tokens[i + 1], '.') && punct(tokens[i + 3], '(') && is(tokens[i + 4], 'str')) out.push(stringValue(tokens[i + 4]));
  }
  return out;
}

/** True when the call statement starting at token `s` starts a statement. */
function atStatementStart(src, s) {
  const { tokens, match } = src;
  const prev = tokens[s - 1];
  if (!prev) return true;
  if (punct(prev, ';') || punct(prev, '{') || punct(prev, '}')) return true;
  if (word(prev, 'else') || word(prev, 'do')) return true;
  if (punct(prev, ')') && match[s - 1] >= 0 && ['if', 'while', 'for', 'with'].some((w) => word(tokens[match[s - 1] - 1], w))) return true;
  return tokens[s].nl && endsExpression(prev);
}

/**
 * Statement-level call sites of a function (`name(...)`) or of a method
 * (`a.b.name(...)`): a call that is a whole expression statement, alone
 * or under `await`. Each is [start, end) as character offsets.
 *
 * @param {ReturnType<typeof parseSource>} src
 * @param {string} name
 * @param {{ method: boolean }} opts
 * @returns {Array<[number, number]>}
 */
export function statementCalls(src, name, { method }) {
  const { tokens, match } = src;
  const out = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (!word(tokens[i], name) || !punct(tokens[i + 1], '(') || match[i + 1] < 0) continue;
    let s = i;
    const dotted = punct(tokens[i - 1], '.') || punct(tokens[i - 1], '?.');
    if (method !== dotted) continue;
    if (method) {
      // The receiver: a chain of names, `a.b.name(` or `this.name(`.
      s = i - 2;
      if (!is(tokens[s], 'id')) continue;
      while ((punct(tokens[s - 1], '.') || punct(tokens[s - 1], '?.')) && is(tokens[s - 2], 'id')) s -= 2;
    }
    if (word(tokens[s - 1], 'await')) s -= 1;
    const close = match[i + 1];
    const next = tokens[close + 1];
    const ends = !next || punct(next, ';') || punct(next, '}') || (next.nl && beginsStatement(next));
    if (!ends || !atStatementStart(src, s)) continue;
    out.push([tokens[s].start, tokens[close].end]);
  }
  return out;
}

// ------------------------------------------------------------ views

export const JS_EXT = /\.(?:js|mjs|cjs)$/;
const TS_EXT = /\.(?:ts|mts|cts)$/;
const JSX_EXT = /\.(?:tsx|jsx)$/;
// Every file the audit reads: JavaScript, and TypeScript, JSX and Vue as US-19904 rules.
export const READ_EXT = /\.(?:js|mjs|cjs|ts|mts|cts|tsx|jsx|vue)$/;

/**
 * The 1-based line and column of an offset (the stage-keeper's ruling 1):
 * `line` counts the line breaks wholly before the offset, a line break
 * being CRLF (one), a lone CR or LF (U+2028, U+2029, VT and FF are not);
 * `col` counts UTF-16 code units from the start of that line, every unit
 * one (a tab, a byte order mark, a combining mark, each half of a
 * surrogate pair).
 *
 * @param {string} text
 * @param {number} offset
 * @returns {{ line: number, col: number }}
 */
export function positionOf(text, offset) {
  let line = 1;
  let start = 0;
  for (let i = 0; i < offset; i += 1) {
    const c = text[i];
    if (c === '\n') { line += 1; start = i + 1; } else if (c === '\r') {
      if (text[i + 1] !== '\n') { line += 1; start = i + 1; } else if (i + 1 < offset) { line += 1; start = i + 2; i += 1; }
    }
  }
  return { line, col: offset - start + 1 };
}

const lineCol = (text, at) => { const p = positionOf(text, at); return `${p.line}:${p.col}`; };

// The construct each strip-mode refusal names, found by its first token.
const NON_ERASABLE = [
  [/\benum\b/, (t, k) => word(t[k], 'enum') && is(t[k + 1], 'id'), (t, k) => `enum ${t[k + 1].text}`],
  [/namespace|module/, (t, k) => (word(t[k], 'namespace') || word(t[k], 'module')) && (is(t[k + 1], 'id') || is(t[k + 1], 'str')), (t, k) => `namespace ${t[k + 1].text}`],
  [/parameter propert/, (t, k) => ['public', 'private', 'protected', 'readonly'].some((w) => word(t[k], w)) && is(t[k + 1], 'id') && !punct(t[k + 2], '('), (t, k) => `parameter property ${t[k + 1].text}`],
  [/import|export/, (t, k) => (word(t[k], 'import') || word(t[k], 'export')) && (punct(t[k + 1], '=') || (is(t[k + 1], 'id') && punct(t[k + 2], '='))), (t, k) => `${t[k].text} =`],
];

// stripTypeScriptTypes warns once that it is experimental; the audit's own output carries no such line.
function strip(text) {
  const emit = process.emitWarning;
  process.emitWarning = () => {};
  try {
    return stripTypeScriptTypes(text, { mode: 'strip' });
  } finally {
    process.emitWarning = emit;
  }
}

/** node's strip-mode error: the line its stack opens with (":<line>"), and its caret line's first caret with the line printed above it. */
function caretOf(err) {
  const lines = String(err?.stack ?? '').split('\n');
  const head = /:(\d+)$/.exec(lines[0]);
  const k = lines.findIndex((l, i) => i > 1 && /^\s*\^+\s*$/.test(l));
  return { line: head ? Number(head[1]) : null, caret: k < 0 ? -1 : lines[k].indexOf('^'), shown: k < 0 ? null : lines[k - 1] };
}

const ID_CHAR = /[\p{ID_Continue}\u200c\u200d]/u;

/**
 * The width-neutral shadow of a text (the stage-keeper's ruling 2): the
 * same UTF-16 length, every unit printable ASCII of display width one,
 * so node's caret index in it is the offset. Every CR becomes LF (node's
 * snippet splits on LF only); U+2028 and U+2029 become LF outside a
 * string and `z` inside one; tab, VT, FF and every other whitespace a
 * space; identifier characters `z` (`zz` when astral); any other
 * non-ASCII unit `z` inside a string (a string, template or regular
 * expression literal) and a space elsewhere, or, with `keep`, as written
 * outside literals.
 */
function shadowOf(text, keep) {
  const literal = new Uint8Array(text.length);
  const mark = (tokens) => {
    for (const t of tokens) {
      if (t.type !== 'str' && t.type !== 'tpl' && t.type !== 'regex') continue;
      literal.fill(1, t.start, t.end);
      for (const part of t.inner ?? []) {
        literal.fill(0, part.start, part.end);
        mark(part.tokens);
      }
    }
  };
  mark(lex(text, 0, false).tokens);
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const u = text.charCodeAt(i);
    if (u === 10 || u === 13) { out += '\n'; continue; }
    if (u >= 0x20 && u < 0x7f) { out += text[i]; continue; }
    const cp = text.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    const units = ch.length;
    let as;
    if (u === 9 || u === 11 || u === 12) as = ' ';
    else if (literal[i]) as = 'z';
    else if (u === 0x2028 || u === 0x2029) as = '\n';
    else if (/\s/u.test(ch)) as = ' ';
    else if (ID_CHAR.test(ch)) as = 'z';
    else as = keep ? ch : ' ';
    out += as === ch ? ch : as.repeat(units);
    i += units - 1;
  }
  return out;
}

/**
 * Where the innermost construct still open at the end of the input opens
 * (the stage-keeper's ruling 3): an unterminated block comment, template
 * literal or string, else the last unmatched "(", "[" or "{". -1 when
 * nothing is open.
 */
function openAtEnd(text) {
  const { tokens, open } = lex(text, 0, false);
  if (open !== undefined) return open;
  const brackets = pairBrackets(tokens).open;
  return brackets.length ? tokens[brackets[brackets.length - 1]].start : -1;
}

/**
 * The offset of the construct node's strip-mode error places in `text`,
 * or -1 when it cannot be placed. node stays the judge (the stage-keeper's
 * ruling 2): its caret is read in the width-neutral shadow, which node
 * refuses with the same code and message; with no caret, the input ends
 * inside a construct, placed where the innermost one still open opens.
 */
function refusalOffset(text, err) {
  const at = caretOf(err);
  if (at.line === null) return -1;
  if (at.caret < 0) return err.code === 'ERR_INVALID_TYPESCRIPT_SYNTAX' ? openAtEnd(text) : -1;
  for (const keep of [false, true]) {
    const shadow = shadowOf(text, keep);
    let again = null;
    try { strip(shadow); } catch (e) { again = e; }
    if (again?.code !== err.code || again.message !== err.message) continue;
    const s = caretOf(again);
    if (s.line === null || s.caret < 0) continue;
    let start = 0;
    for (let l = 1; l < s.line && start >= 0; l += 1) start = shadow.indexOf('\n', start) + 1 || -1;
    if (start < 0) continue;
    const end = shadow.indexOf('\n', start);
    if (s.shown !== shadow.slice(start, end < 0 ? shadow.length : end)) continue;
    return start + s.caret;
  }
  return -1;
}

/**
 * The strip-mode view of TypeScript text, or the refusal: "<file>:<line>:<col>:
 * non-erasable TypeScript syntax (<construct>)" (the stage-keeper's ruling F6)
 * or "<file>:<line>:<col>: invalid TypeScript syntax (<message>)", at the
 * offset refusalOffset gives, counted in `source` (the file as committed,
 * of which `text` is a view of the same length) by positionOf. A refusal
 * it cannot place (the stage-keeper's ruling 4: no input reaches it) reads
 * node's line and column 1, marked `unplaced`.
 */
function stripView(file, text, source = text) {
  try {
    return { ok: true, text: strip(text) };
  } catch (err) {
    if (err?.code !== 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX' && err?.code !== 'ERR_INVALID_TYPESCRIPT_SYNTAX') throw err;
    const at = refusalOffset(text, err);
    const where = (offset) => `${file}:${lineCol(source, offset)}`;
    const unplaced = (what) => ({ ok: false, unplaced: true, detail: `${file}:${caretOf(err).line ?? 1}:1: ${what}` });
    if (err.code === 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX') {
      const { tokens } = parseSource(text);
      const what = String(err.message).replace(/^TypeScript /, '').replace(/ is not supported in strip-only mode$/, '');
      if (at >= 0) {
        // The construct node refused, named from the token at its offset
        // (a parameter property's caret sits on the name after its modifier).
        const i = tokens.findIndex((t) => t.start === at);
        let named = what;
        for (const [re, is, name] of NON_ERASABLE) {
          const k = i < 0 || !re.test(err.message) ? undefined : [i, i - 1].find((j) => j >= 0 && is(tokens, j));
          if (k !== undefined) { named = name(tokens, k); break; }
        }
        return { ok: false, detail: `${where(at)}: non-erasable TypeScript syntax (${named})` };
      }
      for (const [re, is, name] of NON_ERASABLE) {
        if (!re.test(err.message)) continue;
        const k = tokens.findIndex((_, i) => is(tokens, i));
        if (k >= 0) return { ok: false, detail: `${where(tokens[k].start)}: non-erasable TypeScript syntax (${name(tokens, k)})` };
      }
      return unplaced(`non-erasable TypeScript syntax (${what})`);
    }
    if (at >= 0) return { ok: false, detail: `${where(at)}: invalid TypeScript syntax (${err.message})` };
    return unplaced(`invalid TypeScript syntax (${err.message})`);
  }
}

/** The JSX-blanked view, or "JSX scan failed at <file>:<line>:<col>: <what the scanner met>". */
function jsxView(file, text) {
  const r = blankJsx(text);
  return r.ok ? r : { ok: false, detail: `JSX scan failed at ${file}:${lineCol(text, r.at)}: ${r.what}` };
}

/**
 * The SFC script view (the stage-keeper's ruling Q9): every <script> and
 * <script setup> block (lang ts, tsx or js) in place, in document order,
 * everything else blanked with its line breaks kept. A block with a src
 * attribute, or another lang, is unreadable.
 */
function sfcView(file, text) {
  const view = text.replace(/[^\r\n]/g, ' ').split('');
  const open = /<script\b([^>]*)>/gi;
  const langs = new Set();
  let m;
  while ((m = open.exec(text))) {
    const attrs = m[1];
    const at = `${file}:${lineCol(text, m.index)}`;
    if (/(?:^|\s)src\s*=/i.test(attrs)) return { ok: false, detail: `${at}: a <script> block with a src attribute` };
    const lang = (/\blang\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1] ?? 'js').toLowerCase();
    if (!['js', 'ts', 'tsx'].includes(lang)) return { ok: false, detail: `${at}: a <script lang="${lang}"> block` };
    langs.add(lang);
    const from = m.index + m[0].length;
    const close = text.toLowerCase().indexOf('</script', from);
    if (close < 0) return { ok: false, detail: `${at}: an unclosed <script> block` };
    for (let k = from; k < close; k += 1) view[k] = text[k];
    open.lastIndex = close;
  }
  let out = { ok: true, text: view.join('') };
  if (langs.has('tsx')) out = jsxView(file, out.text);
  if (out.ok && (langs.has('ts') || langs.has('tsx'))) out = stripView(file, out.text, text);
  return out;
}

/**
 * The view the audit reads a file through (same length as the file), or
 * why it cannot: { ok: true, text } | { ok: false, detail }. A file of no
 * readable kind reads "<file>:1:1: unsupported file type <ext>" (the
 * stage-keeper's ruling F11).
 *
 * @param {string} file - project-relative path
 * @param {string} text
 */
export function sourceView(file, text) {
  if (JS_EXT.test(file)) return { ok: true, text };
  if (TS_EXT.test(file)) return stripView(file, text);
  if (JSX_EXT.test(file)) {
    const r = jsxView(file, text);
    return r.ok && file.endsWith('.tsx') ? stripView(file, r.text, text) : r;
  }
  if (file.endsWith('.vue')) return sfcView(file, text);
  return { ok: false, detail: `${file}:1:1: unsupported file type ${extname(file) || '(none)'}` };
}

/**
 * parseSource over a file's view, carrying the original text: token
 * offsets index both, so a rewrite spliced at them edits the original.
 * Throws when the view cannot be read.
 */
export function parseFile(file, text) {
  const v = sourceView(file, text);
  if (!v.ok) throw new Error(v.detail);
  return { ...parseSource(v.text), text };
}
