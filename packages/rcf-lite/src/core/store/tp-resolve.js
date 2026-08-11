// Test-pointer working-tree resolution (w-2026-07-28-005).
//
// This is the test-axis twin of `cn-resolve.js`. Every Test Case declares a
// `testPointer` (`filePath::testName`). This module checks each pointer
// against the CHECKED-OUT WORKING TREE: the file must exist AND a
// declaration-anchor regex must find the named test inside it. Coverage
// (`rcf coverage`) consumes the result: a TC whose pointer does not resolve
// is never counted as covering its AC - it surfaces as `covered-unresolved`
// instead. Without this, a tree full of stub TC rows reports full coverage
// while pointing at nothing.
//
// Determinism (same posture as cn-resolve): file existence is `fs.stat`;
// test presence is a fixed set of declaration-anchor regexes per language.
// No LLM, no test execution, no parsing beyond regex. Fully reproducible
// given a working tree.
//
// Language support is an anchor TABLE, keyed by file extension: adding a
// language is one entry (id, extensions, anchorsFor). JS/TS ships now, with
// anchors derived from this repo's own corpus (1022 x `test('name', ...)`
// plus template-literal names) widened to the common `test` / `it` /
// `describe` declaration forms and their `.only` / `.skip` / `.each`
// modifier chains, across all three quote styles (', ", `).
//
// HONEST LIMITATION (inherited from cn-resolve, same register as
// docs/code-nodes.md): the anchor check proves a test DECLARATION with that
// name exists - not that the test still asserts what the AC says. A renamed
// test is caught; a gutted-but-same-named test is NOT caught (semantic drift
// is out of reach for a deterministic check). A test name built from a
// template-literal interpolation cannot be anchored statically and reports
// unresolved unless the pointer carries the literal source text.

import { readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';

/**
 * Split a test pointer into its file part and test-name part.
 * The separator is the FIRST `::`; test names may themselves contain `::`.
 * @param {string} pointer e.g. "test/store/loader.test.js::loads a document"
 * @returns {{ file: string, testName: string | null }}
 */
export function splitTestPointer(pointer) {
  const sep = pointer.indexOf('::');
  if (sep < 0) return { file: pointer, testName: null };
  const testName = pointer.slice(sep + 2);
  return { file: pointer.slice(0, sep), testName: testName.length > 0 ? testName : null };
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The anchor table. One entry per supported language; adding a language is
// adding an entry (nothing else changes). `anchorsFor` returns the
// deterministic declaration-anchor matchers for a test name; a test is
// considered PRESENT if any anchor matches the file text.
const ANCHOR_LANGUAGES = [
  {
    id: 'javascript',
    extensions: ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx'],
    anchorsFor(testName) {
      const n = escapeRegExp(testName);
      // `test('name'` / `it("name"` / `describe(`name`` plus modifier
      // chains (`test.skip(`, `it.only(`, `test.each(...)(` is NOT chased -
      // parameterised names are dynamic and out of deterministic reach).
      const head = String.raw`\b(?:test|it|describe)(?:\.\w+)*\s*\(\s*`;
      return [
        new RegExp(`${head}'${n}'`),
        new RegExp(`${head}"${n}"`),
        new RegExp(`${head}\`${n}\``),
      ];
    },
  },
];

function languageForFile(file) {
  const ext = extname(file).toLowerCase();
  return ANCHOR_LANGUAGES.find((lang) => lang.extensions.includes(ext)) ?? null;
}

/**
 * @typedef {object} TestPointerResolution
 * @property {boolean} resolved
 * @property {'ok'|'missing-pointer'|'malformed-pointer'|'unsupported-file-type'|'file-missing'|'test-missing'} reason
 * @property {string|null} testPointer - the raw pointer (null when absent)
 * @property {string} tsId
 * @property {string} tcId
 */

/**
 * Key for the per-TC resolution map. Exported so consumers (coverage) and
 * this module agree on one spelling.
 * @param {string} tsId
 * @param {string} tcId
 * @returns {string}
 */
export function testCaseKey(tsId, tcId) {
  return `${tsId}::${tcId}`;
}

/**
 * Resolve every Test Case's `testPointer` in the tree against the working
 * tree. Returns a Map keyed by `testCaseKey(tsId, tcId)`; every TC in the
 * tree gets an entry, resolved or not. A per-file read cache avoids
 * re-reading a file that multiple TCs point into (same posture as
 * cn-resolve's cache).
 *
 * @param {object} args
 * @param {string} args.projectRoot - absolute path to project root
 * @param {object} args.tree - walker TreeModel (carries tree.testSuites)
 * @returns {Promise<Map<string, TestPointerResolution>>}
 */
export async function resolveTestPointers({ projectRoot, tree }) {
  /** @type {Map<string, TestPointerResolution>} */
  const results = new Map();
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

  for (const ts of tree.testSuites ?? []) {
    for (const tc of ts.testCases ?? []) {
      if (!tc?.id) continue;
      const key = testCaseKey(ts.id, tc.id);
      const record = (resolved, reason, pointer = null) => {
        results.set(key, { resolved, reason, testPointer: pointer, tsId: ts.id, tcId: tc.id });
      };

      const pointer = tc.testPointer;
      if (typeof pointer !== 'string' || pointer.length === 0) {
        record(false, 'missing-pointer');
        continue;
      }
      const { file, testName } = splitTestPointer(pointer);
      if (!testName || file.length === 0) {
        record(false, 'malformed-pointer', pointer);
        continue;
      }
      const language = languageForFile(file);
      if (!language) {
        record(false, 'unsupported-file-type', pointer);
        continue;
      }

      const absFile = join(projectRoot, file);
      let fileOk = false;
      try {
        const st = await stat(absFile);
        fileOk = st.isFile();
      } catch {
        fileOk = false;
      }
      if (!fileOk) {
        record(false, 'file-missing', pointer);
        continue;
      }

      const text = await readFileCached(absFile);
      const present = text != null && language.anchorsFor(testName).some((re) => re.test(text));
      if (!present) {
        record(false, 'test-missing', pointer);
        continue;
      }
      record(true, 'ok', pointer);
    }
  }
  return results;
}
