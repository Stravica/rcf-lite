// Python sources in `rcf audit test-strength` (FBS-244, US-19905). A
// symbol-level .py Code Node is read through the host's python3 with the
// standard library ast module only: no Python package is installed and no
// project code is imported or run. The reader is one constant program run
// as `python3 -I -B -c <program> <file>` in a scratch directory of its
// own, with the file's text on stdin and JSON on stdout: the module's
// top-level functions and classes (each method with its body's span) and
// its statement-level call sites. The rewrites themselves are spliced in
// JavaScript at those spans, so the rest of each file stays byte for byte
// as committed (CRLF and non-ASCII text included). The operators are the
// JavaScript ones (mutants.js): stubToThrow (the body raises), noOp (the
// body is `pass`) and callRemoval (each statement-level call becomes
// `None`), so the TestStrengthReport v1 shape is unchanged.
//
// python3 is probed once per run (`python3 --version`); absent, older
// than 3.9, or giving no version, each .py Code Node file is an
// unreadable file of its criterion (blocked), never a crash.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const PY_EXT = /\.py$/;
/** The oldest python3 the reader runs on: ast end positions and the parser it relies on. */
export const PYTHON_FLOOR = [3, 9];
const PROBE_TIMEOUT_MS = 10_000;
const READ_TIMEOUT_MS = 30_000;

// The structure reader. Positions are ast's: 1-based lines, 0-based
// columns in UTF-8 bytes. A body's span is [startLine, startCol, endLine,
// endCol, decorated]: ast places a decorated def or class at its `def` or
// `class` line, so when the first statement of a body is one, the span
// starts at its earliest decorator's `@` and decorated is 1. The `@` is
// taken from the source's tokens (the stdlib tokenize module), never from
// the decorator's expression: for a parenthesised decorator such as
// `@(name)` ast places the expression after the paren, and comments and
// line breaks may stand inside it. It is the last `@` token before the
// expression, since only brackets, blanks and comments come between. A
// file python3 cannot parse gives the SyntaxError's line, column
// (1-based) and message instead.
const READER = [
  'import ast, io, json, sys, tokenize',
  'text = sys.stdin.buffer.read().decode("utf-8-sig", "surrogateescape")',
  'try:',
  '    tree = ast.parse(text, sys.argv[1])',
  'except (SyntaxError, ValueError) as e:',
  '    print(json.dumps({"syntax": [getattr(e, "lineno", None) or 1, getattr(e, "offset", None) or 1, getattr(e, "msg", None) or str(e)]}))',
  '    raise SystemExit(0)',
  'FN = (ast.FunctionDef, ast.AsyncFunctionDef)',
  'ats = []',
  'def at(a):',
  '    if not ats:',
  '        ats.append([])',
  '        try:',
  '            for t in tokenize.generate_tokens(io.StringIO(text, newline=None).readline):',
  '                if t.type == tokenize.OP and t.string == "@":',
  '                    ats[0].append((t.start[0], len(t.line[:t.start[1]].encode("utf-8", "surrogateescape"))))',
  '        except (tokenize.TokenError, SyntaxError, ValueError):',
  '            pass',
  '    p = [x for x in ats[0] if x < (a.lineno, a.col_offset)]',
  '    return list(max(p)) if p else [a.lineno, a.col_offset]',
  'def body(n):',
  '    s, e = n.body[0], n.body[-1]',
  '    d = getattr(s, "decorator_list", None)',
  '    l, c = at(d[0]) if d else (s.lineno, s.col_offset)',
  '    return [l, c, e.end_lineno, e.end_col_offset, 1 if d else 0]',
  'def named(n):',
  '    while isinstance(n, ast.Attribute):',
  '        n = n.value',
  '    return isinstance(n, ast.Name)',
  'decls = []',
  'for n in tree.body:',
  '    if isinstance(n, FN):',
  '        decls.append({"kind": "function", "name": n.name, "body": body(n)})',
  '    elif isinstance(n, ast.ClassDef):',
  '        decls.append({"kind": "class", "name": n.name, "methods": [{"name": m.name, "body": body(m)} for m in n.body if isinstance(m, FN)]})',
  'calls = []',
  'for n in ast.walk(tree):',
  '    if isinstance(n, ast.Expr):',
  '        v = n.value.value if isinstance(n.value, ast.Await) else n.value',
  '        if isinstance(v, ast.Call) and isinstance(v.func, ast.Name):',
  '            calls.append([v.func.id, False, n.lineno, n.col_offset, n.end_lineno, n.end_col_offset])',
  '        elif isinstance(v, ast.Call) and isinstance(v.func, ast.Attribute) and named(v.func.value):',
  '            calls.append([v.func.attr, True, n.lineno, n.col_offset, n.end_lineno, n.end_col_offset])',
  'print(json.dumps({"decls": decls, "calls": calls}))',
].join('\n');

/**
 * The host's python3, probed from PATH: { ok: true, version } when it is
 * 3.9 or later, else { ok: false, why } with why one of "python3 not
 * found", "python3 is <version>" or "python3 gave no version" (its
 * --version exits non-zero, times out or prints no parseable version).
 *
 * @param {typeof spawnSync} [run]
 */
export function probePython(run = spawnSync) {
  const r = run('python3', ['--version'], { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.error?.code === 'ENOENT') return { ok: false, why: 'python3 not found' };
  const m = !r.error && r.status === 0 ? /^Python (\d+)\.(\d+)(\S*)/m.exec(`${r.stdout ?? ''}\n${r.stderr ?? ''}`) : null;
  if (!m) return { ok: false, why: 'python3 gave no version' };
  const version = `${m[1]}.${m[2]}${m[3]}`;
  const [major, minor] = [Number(m[1]), Number(m[2])];
  if (major < PYTHON_FLOOR[0] || (major === PYTHON_FLOOR[0] && minor < PYTHON_FLOOR[1])) return { ok: false, why: `python3 is ${version}` };
  return { ok: true, version };
}

/** The string offset of each line's start: a line break is CRLF, a lone CR or LF (as Python reads source); a byte order mark is not on line 1. */
function lineStarts(text) {
  const starts = [text.charCodeAt(0) === 0xfeff ? 1 : 0];
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c === 10) starts.push(i + 1);
    else if (c === 13) {
      if (text.charCodeAt(i + 1) === 10) i += 1;
      starts.push(i + 1);
    }
  }
  return starts;
}

/**
 * The string offset (UTF-16 code units) of an ast position: a 1-based
 * line and a column in UTF-8 bytes from that line's start.
 *
 * @param {{ text: string, lines: number[] }} py
 * @param {number} line
 * @param {number} byteCol
 */
export function pyOffset(py, line, byteCol) {
  let i = py.lines[line - 1] ?? py.text.length;
  for (let b = 0; b < byteCol && i < py.text.length;) {
    const cp = py.text.codePointAt(i);
    b += cp < 0x80 ? 1 : (cp < 0x800 ? 2 : (cp < 0x10000 ? 3 : 4));
    i += cp > 0xffff ? 2 : 1;
  }
  return i;
}

/**
 * Read one .py file's structure through python3: { ok: true, text,
 * lines, decls, calls }, or { ok: false, detail } where detail is
 * "<file>:<line>:<col>: <message>" for a file python3 cannot parse and
 * "<file>: python3 structure read failed (<why>)" for any other failure.
 *
 * @param {string} file - project-relative path
 * @param {string} text
 * @param {typeof spawnSync} [run]
 */
export function pythonStructure(file, text, run = spawnSync) {
  const failed = (why) => ({ ok: false, detail: `${file}: python3 structure read failed (${why})` });
  const cwd = mkdtempSync(join(tmpdir(), 'rcf-py-'));
  let r;
  try {
    r = run('python3', ['-I', '-B', '-c', READER, file], { cwd, input: text, encoding: 'utf8', timeout: READ_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
  if (r.error) return failed(r.error.code === 'ETIMEDOUT' ? `timed out after ${READ_TIMEOUT_MS / 1000} s` : (r.error.code ?? r.error.message));
  if (r.status !== 0) {
    const last = String(r.stderr ?? '').trim().split('\n').pop();
    return failed(`exit ${r.status ?? r.signal}${last ? `: ${last}` : ''}`);
  }
  let doc;
  try { doc = JSON.parse(r.stdout); } catch { return failed('no JSON on stdout'); }
  if (Array.isArray(doc?.syntax)) {
    const [line, col, msg] = doc.syntax;
    return { ok: false, detail: `${file}:${line}:${col}: ${msg}` };
  }
  if (!Array.isArray(doc?.decls) || !Array.isArray(doc?.calls)) return failed('no structure on stdout');
  return { ok: true, text, lines: lineStarts(text), decls: doc.decls, calls: doc.calls };
}

/**
 * One run's Python reader: python3 probed at the first .py file, each
 * file's structure read once. `read` gives the structure, or
 * { ok: false, detail } with "<file>: Python sources need python3 >= 3.9
 * on PATH (<why>)" when the probe failed.
 *
 * @param {{ run?: typeof spawnSync }} [opts]
 */
export function pythonReader({ run = spawnSync } = {}) {
  let probed = null;
  const cache = new Map();
  return {
    read(file, text) {
      if (!cache.has(file)) {
        probed ??= probePython(run);
        cache.set(file, probed.ok
          ? pythonStructure(file, text, run)
          : { ok: false, detail: `${file}: Python sources need python3 >= ${PYTHON_FLOOR.join('.')} on PATH (${probed.why})` });
      }
      return cache.get(file);
    },
  };
}

/**
 * The functions a symbol names in a Python module, as mutants.js
 * mutableTargets does for JavaScript: a top-level def (async included),
 * or each method of a top-level class but __init__ (`Class.method` names
 * one); decorated methods are targets like any other. Empty when the
 * symbol names no top-level def or class.
 *
 * @returns {Array<{ name: string, body: number[], method: boolean, callName: string }>}
 */
export function pyTargets(py, symbol) {
  const [head, member] = symbol.split('.');
  const decl = py.decls.find((d) => d.name === head);
  if (!decl) return [];
  if (decl.kind === 'function') return member ? [] : [{ name: head, body: decl.body, method: false, callName: head }];
  return decl.methods
    .filter((m) => m.name !== '__init__' && (!member || m.name === member))
    .map((m) => ({ name: `${head}.${m.name}`, body: m.body, method: true, callName: m.name }));
}

/**
 * The rewritten text for stubToThrow (the body raises a RuntimeError
 * naming the mutant) or noOp (the body is `pass`) on one target, spliced
 * over the body's statements at their own indentation.
 *
 * @param {'stubToThrow'|'noOp'} operator
 * @param {string} label - the mutant's symbol, named in the raised error
 */
export function pyRewriteBody(py, target, operator, label) {
  const [l1, c1, l2, c2, decorated] = target.body;
  let from = pyOffset(py, l1, c1);
  if (decorated && py.text[from] !== '@') {
    // The reader found no `@` token (its tokenize pass failed): back from
    // the earliest decorator's expression to its `@` over blanks, line
    // continuations and opening parens.
    let i = from - 1;
    while (i >= 0 && ' \t\f\r\n\\('.includes(py.text[i])) i -= 1;
    if (py.text[i] === '@') from = i;
  }
  const stmt = operator === 'noOp' ? 'pass' : `raise RuntimeError(${JSON.stringify(`rcf test-strength: stubToThrow on ${label}`)})`;
  return `${py.text.slice(0, from)}${stmt}${py.text.slice(pyOffset(py, l2, c2))}`;
}

/**
 * callRemoval over the project's .py files: each statement-level call of
 * the target (`name(...)` for a def, `a.b.name(...)` for a method, alone
 * or under await) becomes `None`. A .py file python3 cannot read has no
 * call site the audit can find. Returns the rewritten files (empty when
 * there is no call site: notApplicable).
 *
 * @param {{ callName: string, method: boolean }} target
 * @param {Map<string, string>} sources - project-relative path -> HEAD text
 * @param {ReturnType<typeof pythonReader>} reader
 * @returns {Map<string, string>}
 */
export function pyRemoveCalls(target, sources, reader) {
  const edits = new Map();
  for (const [path, text] of sources) {
    if (!PY_EXT.test(path) || !text.includes(target.callName)) continue;
    const py = reader.read(path, text);
    if (!py.ok) continue;
    const sites = py.calls
      .filter(([name, dotted]) => name === target.callName && dotted === target.method)
      .map(([, , l1, c1, l2, c2]) => [pyOffset(py, l1, c1), pyOffset(py, l2, c2)])
      .sort((a, b) => b[0] - a[0]);
    if (!sites.length) continue;
    let out = text;
    for (const [from, to] of sites) out = `${out.slice(0, from)}None${out.slice(to)}`;
    edits.set(path, out);
  }
  return edits;
}
