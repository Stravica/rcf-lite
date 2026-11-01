// The JSX scanner of `rcf audit test-strength` (FBS-242, US-19904,
// AC-19904-4, the stage-keeper's ruling Q8): each JSX element in a .tsx
// or .jsx file is blanked to a same-length expression (`0` and spaces,
// line breaks kept), so the rest of the file keeps its offsets and the
// tokenizer reads it as plain script. Accepted: elements, self-closing
// elements, fragments, attributes (string, expression container,
// spread), expression containers with nested JSX, text, and comments
// inside containers. Anything the scanner cannot close, or any other
// construct, is a scan failure with its position, never a guess.

const ID_START = /[A-Za-z_$\u0080-￿]/;
const ID_PART = /[\w$\u0080-￿]/;
const NAME_PART = /[\w$\-:.\u0080-￿]/;
// Keywords after which "<" or "/" starts an expression (JSX or a regular expression).
const EXPR_AFTER = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case',
  'do', 'else', 'yield', 'await', 'default']);

class ScanError extends Error {
  constructor(at, what) {
    super(what);
    this.at = at;
  }
}

/** True when an expression may start after the previous token. */
function exprAllowed(prev) {
  if (!prev) return true;
  if (prev.type === 'punct') return ![')', ']', '}'].includes(prev.text);
  if (prev.type === 'id') return EXPR_AFTER.has(prev.text);
  return false;
}

/**
 * Blank every JSX element of a source text.
 *
 * @param {string} text
 * @returns {{ ok: true, text: string } | { ok: false, at: number, what: string }}
 */
export function blankJsx(text) {
  const out = text.split('');
  const n = text.length;
  const blank = (from, to) => {
    for (let k = from; k < to; k += 1) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
    out[from] = '0';
  };

  const skipSpace = (i) => {
    while (i < n && /\s/.test(text[i])) i += 1;
    return i;
  };

  // Script from `i`; with `container`, up to the "}" closing the
  // container opened at `open`, returning the index after it.
  const scanCode = (i, container = false, open = 0) => {
    let prev = null;
    let depth = 0;
    while (i < n) {
      const c = text[i];
      if (/\s/.test(c)) { i += 1; continue; }
      if (c === '/' && text[i + 1] === '/') { while (i < n && text[i] !== '\n') i += 1; continue; }
      if (c === '/' && text[i + 1] === '*') {
        const close = text.indexOf('*/', i + 2);
        if (close < 0) throw new ScanError(i, 'an unclosed comment');
        i = close + 2;
        continue;
      }
      if (c === '"' || c === "'") {
        i += 1;
        while (i < n && text[i] !== c && text[i] !== '\n') i += text[i] === '\\' ? 2 : 1;
        i += 1;
        prev = { type: 'str' };
        continue;
      }
      if (c === '`') { i = scanTemplate(i + 1); prev = { type: 'str' }; continue; }
      if (ID_START.test(c) || /[0-9]/.test(c)) {
        const s = i;
        i += 1;
        while (i < n && ID_PART.test(text[i])) i += 1;
        prev = { type: /[0-9]/.test(c) ? 'num' : 'id', text: text.slice(s, i) };
        continue;
      }
      if (c === '/' && exprAllowed(prev)) {
        // A regular expression literal; one the line does not close is read as "/".
        let k = i + 1;
        let inClass = false;
        while (k < n && text[k] !== '\n') {
          const ch = text[k];
          if (ch === '\\') { k += 2; continue; }
          if (inClass) { if (ch === ']') inClass = false; } else if (ch === '[') inClass = true; else if (ch === '/') break;
          k += 1;
        }
        if (k < n && text[k] === '/') {
          i = k + 1;
          while (i < n && ID_PART.test(text[i])) i += 1;
          prev = { type: 'regex' };
          continue;
        }
      }
      if (c === '<' && exprAllowed(prev) && (text[i + 1] === '>' || ID_START.test(text[i + 1] ?? ''))) {
        const end = scanElement(i);
        blank(i, end);
        i = end;
        prev = { type: 'jsx' };
        continue;
      }
      if (c === '{') depth += 1;
      if (c === '}') {
        if (container && depth === 0) return i + 1;
        depth -= 1;
      }
      prev = { type: 'punct', text: c };
      i += 1;
    }
    if (container) throw new ScanError(open, 'an unclosed {');
    return i;
  };

  const scanTemplate = (i) => {
    const open = i - 1;
    while (i < n) {
      const ch = text[i];
      if (ch === '\\') { i += 2; continue; }
      if (ch === '`') return i + 1;
      if (ch === '$' && text[i + 1] === '{') { i = scanCode(i + 2, true, i); continue; }
      i += 1;
    }
    throw new ScanError(open, 'an unclosed template literal');
  };

  // An expression container at "{": empty, a comment, or script.
  const scanContainer = (i) => scanCode(i + 1, true, i);

  const readName = (i) => {
    const s = i;
    while (i < n && NAME_PART.test(text[i])) i += 1;
    return [text.slice(s, i), i];
  };

  // A JSX element or fragment at "<"; returns the index after it.
  const scanElement = (start) => {
    let i = start + 1;
    let name = '';
    if (text[i] !== '>') {
      [name, i] = readName(i);
      if (!name) throw new ScanError(i, 'a tag with no name');
      for (;;) {
        i = skipSpace(i);
        if (i >= n) throw new ScanError(start, `an unclosed <${name}>`);
        if (text[i] === '/' && text[i + 1] === '>') return i + 2;
        if (text[i] === '>') break;
        if (text[i] === '{') { i = scanContainer(i); continue; }
        const [attr, after] = readName(i);
        if (!attr) throw new ScanError(i, `${JSON.stringify(text[i])} in the tag <${name}>`);
        i = skipSpace(after);
        if (text[i] !== '=') continue;
        i = skipSpace(i + 1);
        const q = text[i];
        if (q === '"' || q === "'") {
          const close = text.indexOf(q, i + 1);
          if (close < 0) throw new ScanError(i, `an unclosed attribute value in <${name}>`);
          i = close + 1;
        } else if (q === '{') {
          i = scanContainer(i);
        } else {
          throw new ScanError(i, `${JSON.stringify(q ?? '')} as the value of ${attr} in <${name}>`);
        }
      }
    }
    i += 1;
    // Children: text, containers and elements, up to the closing tag.
    for (;;) {
      if (i >= n) throw new ScanError(start, `an unclosed <${name}>`);
      const c = text[i];
      if (c === '<' && text[i + 1] === '/') {
        const at = i;
        let close;
        [close, i] = readName(skipSpace(i + 2));
        i = skipSpace(i);
        if (text[i] !== '>') throw new ScanError(at, `a malformed closing tag for <${name}>`);
        if (close !== name) throw new ScanError(at, `</${close}> closing <${name}>`);
        return i + 1;
      }
      if (c === '<') { i = scanElement(i); continue; }
      if (c === '{') { i = scanContainer(i); continue; }
      if (c === '}' || c === '>') throw new ScanError(i, `${JSON.stringify(c)} in JSX text`);
      i += 1;
    }
  };

  try {
    scanCode(0);
  } catch (err) {
    if (err instanceof ScanError) return { ok: false, at: err.at, what: err.message };
    throw err;
  }
  return { ok: true, text: out.join('') };
}
