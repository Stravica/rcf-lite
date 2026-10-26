// The mutant applier of `rcf audit test-strength` (FBS-236, US-19902,
// TAC-4155, ADR-4156). For each symbol-level Code Node of a criterion it
// writes three source rewrites of the symbol's function (or of each
// method of the class it names): stubToThrow (the body throws), noOp (the
// body is empty) and callRemoval (every statement-level call of it in
// the project's source files becomes `void 0`; notApplicable when there
// is none). A file-level Code Node on a path that is not source gets
// fileBlank (the file is emptied). Rewrites are spliced into the text at
// the token boundaries source.js finds, so the rest of each file is
// byte-identical; they are applied only inside the scratch worktree.

import { posix } from 'node:path';

import { findDeclaration, parseSource, statementCalls } from './source.js';

export const SOURCE_EXT = /\.(?:js|mjs|cjs)$/;
// TAC-4155: a file-level Code Node on one of these is not a supported source.
export const CODE_EXT = /\.(?:ts|tsx|jsx|py|rb|go|java|kt|rs|php|cs|swift)$/;
export const SYMBOL_OPERATORS = ['stubToThrow', 'noOp', 'callRemoval'];

/** Split a Code Node path into its normalised file and its symbol (or null). */
export function splitNode(cnPath) {
  const hash = cnPath.indexOf('#');
  const file = posix.normalize(hash < 0 ? cnPath : cnPath.slice(0, hash)).replace(/^\.\//, '');
  return { file, symbol: hash < 0 ? null : cnPath.slice(hash + 1) };
}

/**
 * The functions a symbol names in a module: the function itself (a
 * declaration or a function-valued initialiser), or each method of a
 * class (the constructor aside; `Class.method` names one). Empty when the
 * symbol is not declared there or is not a function or class (a
 * constant, an object literal, a re-export).
 *
 * @returns {Array<{ name: string, fn: object, method: boolean, callName: string }>}
 */
export function mutableTargets(src, symbol) {
  const [head, member] = symbol.split('.');
  const decl = findDeclaration(src, head);
  if (!decl) return [];
  if (decl.kind === 'function') return member ? [] : [{ name: head, fn: decl, method: false, callName: head }];
  if (decl.kind !== 'class') return [];
  return decl.methods
    .filter((m) => !m.constructor && m.name && (!member || m.name === member))
    .map((m) => ({ name: `${head}.${m.name}`, fn: m, method: true, callName: m.name }));
}

/** The text with the function's body replaced by `body` (a block, braces included). */
function replaceBody(src, fn, body) {
  const { text, tokens } = src;
  if (fn.body) return `${text.slice(0, tokens[fn.body[0]].start)}${body}${text.slice(tokens[fn.body[1]].end)}`;
  const [from, to] = fn.concise;
  return `${text.slice(0, tokens[from].start)}${body}${text.slice(tokens[to - 1].end)}`;
}

/**
 * The rewritten text for stubToThrow or noOp on one target.
 *
 * @param {ReturnType<typeof parseSource>} src
 * @param {{ fn: object }} target
 * @param {'stubToThrow'|'noOp'} operator
 * @param {string} label - the mutant's symbol, named in the thrown error
 */
export function rewriteBody(src, target, operator, label) {
  if (operator === 'noOp') return replaceBody(src, target.fn, '{}');
  return replaceBody(src, target.fn, `{ throw new Error(${JSON.stringify(`rcf test-strength: stubToThrow on ${label}`)}); }`);
}

/**
 * callRemoval over the project's source files: each statement-level call
 * of the target becomes `void 0`. Returns the rewritten files (empty when
 * there is no call site: notApplicable).
 *
 * @param {{ callName: string, method: boolean }} target
 * @param {Map<string, string>} sources - project-relative path -> HEAD text
 * @param {Map<string, object>} parsed - cache of parseSource per path
 * @returns {Map<string, string>}
 */
export function removeCalls(target, sources, parsed) {
  const edits = new Map();
  for (const [path, text] of sources) {
    if (!text.includes(target.callName)) continue;
    if (!parsed.has(path)) parsed.set(path, parseSource(text));
    const sites = statementCalls(parsed.get(path), target.callName, { method: target.method });
    if (!sites.length) continue;
    let out = text;
    for (const [from, to] of [...sites].reverse()) out = `${out.slice(0, from)}void 0${out.slice(to)}`;
    edits.set(path, out);
  }
  return edits;
}

/**
 * The mutants of one criterion's Code Nodes, in Code Node order: three
 * per target of each symbol-level node, one fileBlank per file-level node
 * on a non-source path. Each carries the files it rewrites (`edits`), or
 * result notApplicable for a callRemoval with no call site. `unmutable`
 * lists the symbol-level nodes that name no function or class;
 * `fileLevelSource` counts file-level nodes on source files (never
 * mutated).
 *
 * @param {Array<{ path: string }>} nodes
 * @param {{ texts: Map<string, string|null>, sources: () => Promise<Map<string, string>>, parsed: Map<string, object> }} ctx
 */
export async function criterionMutants(nodes, { texts, sources, parsed }) {
  const mutants = [];
  const unmutable = [];
  let symbolLevel = 0;
  let fileLevelSource = 0;
  for (const node of nodes) {
    const { file, symbol } = splitNode(node.path);
    if (!symbol) {
      if (SOURCE_EXT.test(file)) { fileLevelSource += 1; continue; }
      mutants.push({ symbol: file, operator: 'fileBlank', edits: new Map([[file, '']]) });
      continue;
    }
    symbolLevel += 1;
    const text = texts.get(file);
    if (typeof text !== 'string') { unmutable.push(node.path); continue; }
    if (!parsed.has(file)) parsed.set(file, parseSource(text));
    const src = parsed.get(file);
    const targets = mutableTargets(src, symbol);
    if (!targets.length) { unmutable.push(node.path); continue; }
    for (const target of targets) {
      const label = `${file}#${target.name}`;
      for (const operator of ['stubToThrow', 'noOp']) {
        mutants.push({ symbol: label, operator, edits: new Map([[file, rewriteBody(src, target, operator, label)]]) });
      }
      const edits = removeCalls(target, await sources(), parsed);
      mutants.push(edits.size
        ? { symbol: label, operator: 'callRemoval', edits }
        : { symbol: label, operator: 'callRemoval', edits: null, result: 'notApplicable' });
    }
  }
  return { mutants, unmutable, symbolLevel, fileLevelSource };
}
