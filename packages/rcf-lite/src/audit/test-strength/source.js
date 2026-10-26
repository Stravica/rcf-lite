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
 * Skip a template literal from just after its opening backtick; returns
 * the index after its closing backtick. `${...}` expressions are skipped
 * with the tokenizer itself, so strings and braces inside them are safe.
 */
function skipTemplate(text, at) {
  let i = at;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') { i += 2; continue; }
    if (ch === '`') return i + 1;
    if (ch === '$' && text[i + 1] === '{') { i = lex(text, i + 2, true).end; continue; }
    i += 1;
  }
  return text.length;
}

function regexAllowed(prev) {
  if (!prev) return true;
  if (prev.type === 'punct') return !(prev.text === ')' || prev.text === ']' || prev.text === '++' || prev.text === '--');
  if (prev.type === 'id') return REGEX_AFTER.has(prev.text);
  return false;
}

/**
 * Tokenize from `start`. With `nested` (a template expression) it stops
 * at the first unmatched "}" and returns the index after it.
 *
 * @returns {{ tokens: Array<{ type: string, text: string, start: number, end: number, nl: boolean }>, end: number }}
 */
function lex(text, start, nested) {
  const tokens = [];
  const n = text.length;
  let i = start;
  let nl = false;
  let depth = 0;
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
      if (/[\n\r\u2028\u2029]/.test(text.slice(i, end))) nl = true;
      i = end;
      continue;
    }
    const s = i;
    let type;
    if (c === '"' || c === "'") {
      i += 1;
      while (i < n && text[i] !== c && text[i] !== '\n') i += text[i] === '\\' ? 2 : 1;
      i += 1;
      type = 'str';
    } else if (c === '`') {
      i = skipTemplate(text, i + 1);
      type = 'tpl';
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
          if (depth === 0) return { tokens, end: i };
          depth -= 1;
        }
      }
    }
    tokens.push({ type, text: text.slice(s, i), start: s, end: i, nl });
    nl = false;
  }
  return { tokens, end: n };
}

/**
 * Tokenize one source file, with each bracket's partner (`match`) and
 * each token's bracket depth (`depth`).
 *
 * @param {string} text
 */
export function parseSource(text) {
  const { tokens } = lex(text, 0, false);
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

/** Specifiers passed to mock.module(<string>, ...) (node:test module mocks). */
export function mockedModules(src) {
  const { tokens } = src;
  const out = [];
  for (let i = 0; i + 4 < tokens.length; i += 1) {
    if (word(tokens[i], 'mock') && punct(tokens[i + 1], '.') && word(tokens[i + 2], 'module')
      && punct(tokens[i + 3], '(') && is(tokens[i + 4], 'str')) out.push(stringValue(tokens[i + 4]));
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
