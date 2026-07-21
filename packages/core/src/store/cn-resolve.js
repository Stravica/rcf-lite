// Phase 10 (X2 CodeNode bridge): Code Node working-tree resolution.
//
// This is the STALENESS DETECTOR - X2's headline advantage over sidecar
// approaches (S5/S6/testPointer). Every CN declares a `path` (file-level
// "src/foo.js" or symbol-level "src/foo.js#symbol"). This module checks
// each path against the CHECKED-OUT WORKING TREE and reports the CNs whose
// target no longer resolves. A rename/move/deletion that a sidecar map
// would silently carry as a dead pointer surfaces here as a `staleCode`
// error at `rcf validate` time.
//
// Determinism (spec D6/D13 hold): file existence is `fs.stat`; symbol
// presence is a fixed set of declaration-anchor regexes (function / class /
// const|let|var / method-at-line-start / object-field). No LLM, no
// semantic judgement, no parsing beyond regex. Fully reproducible given a
// working tree.
//
// HONEST LIMITATION (documented in docs/ and the PoC report): the symbol
// check proves a DECLARATION with that name exists - not that it still does
// what the AC says. A symbol renamed is caught; a symbol whose body was
// gutted but whose name survived is NOT caught (semantic drift is out of
// reach for a deterministic check, out of scope per D13). File-level CNs
// cannot detect intra-file symbol moves at all. A symbol moved to another
// file while a same-file namesake declaration survives can false-clean
// (the anchor scan has no lexical scope awareness).

import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { rcfError } from '../errors/index.js';

/**
 * Split a CN path into its file part and optional symbol part.
 * @param {string} cnPath e.g. "src/store/validator.js#getAjv"
 * @returns {{ file: string, symbol: string | null }}
 */
export function splitCnPath(cnPath) {
  const hash = cnPath.indexOf('#');
  if (hash < 0) return { file: cnPath, symbol: null };
  return { file: cnPath.slice(0, hash), symbol: cnPath.slice(hash + 1) };
}

/**
 * Build the deterministic declaration-anchor matchers for a symbol name.
 * A symbol is considered PRESENT if any anchor matches the file text.
 * @param {string} symbol
 * @returns {RegExp[]}
 */
function anchorsFor(symbol) {
  // Escape regex metacharacters in the symbol (identifiers won't normally
  // carry any, but `$` is a legal JS identifier char and a regex metachar).
  const s = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [
    new RegExp(`\\b(?:async\\s+)?function\\s*\\*?\\s+${s}\\b`), // function decl
    new RegExp(`\\bclass\\s+${s}\\b`), // class decl
    new RegExp(`\\b(?:const|let|var)\\s+${s}\\b`), // binding decl
    new RegExp(`^\\s*(?:async\\s+)?(?:static\\s+)?(?:get\\s+|set\\s+)?${s}\\s*\\(`, 'm'), // method/def at line start
    new RegExp(`^\\s*${s}\\s*[:=]`, 'm'), // object-literal / class-field form
  ];
}

/**
 * Check every Code Node in the tree against the working tree. Returns a
 * list of structured `staleCode` errors (empty when all CN paths resolve).
 * A per-file read cache avoids re-reading a file that multiple symbol-level
 * CNs anchor into (spec D8).
 *
 * @param {object} args
 * @param {string} args.projectRoot - absolute path to project root
 * @param {object} args.tree - walker TreeModel (carries tree.codeNodes)
 * @returns {Promise<import('../errors/index.js').RcfError[]>}
 */
export async function checkCodeNodeResolution({ projectRoot, tree }) {
  /** @type {import('../errors/index.js').RcfError[]} */
  const errors = [];
  const fileCache = new Map();

  const readFileCached = async (absFile) => {
    if (fileCache.has(absFile)) return fileCache.get(absFile);
    let text = null;
    try {
      text = await readFile(absFile, 'utf8');
    } catch {
      text = null;
    }
    fileCache.set(absFile, text);
    return text;
  };

  for (const cn of tree.codeNodes ?? []) {
    const cnPath = cn.path ?? '';
    const relFile = `rcf/code-nodes/${(cn.cnId ?? '').toLowerCase()}.json`;
    const { file, symbol } = splitCnPath(cnPath);
    const absFile = join(projectRoot, file);

    // 1. File existence.
    let fileOk = false;
    try {
      const st = await stat(absFile);
      fileOk = st.isFile();
    } catch {
      fileOk = false;
    }
    if (!fileOk) {
      errors.push(rcfError({
        kind: 'staleCode',
        message: `CN ${cn.cnId} path is stale: file ${file} does not exist in the working tree`,
        documentId: cn.cnId,
        filePath: relFile,
        field: 'path',
        rule: 'fileResolves',
      }));
      continue; // no point checking the symbol in a missing file
    }

    // 2. Symbol presence (deterministic anchor scan).
    if (symbol) {
      const text = await readFileCached(absFile);
      const present = text != null && anchorsFor(symbol).some((re) => re.test(text));
      if (!present) {
        errors.push(rcfError({
          kind: 'staleCode',
          message: `CN ${cn.cnId} path is stale: symbol '${symbol}' not found in ${file} (renamed, removed, or moved to another file)`,
          documentId: cn.cnId,
          filePath: relFile,
          field: 'path',
          rule: 'symbolResolves',
        }));
      }
    }
  }
  return errors;
}
