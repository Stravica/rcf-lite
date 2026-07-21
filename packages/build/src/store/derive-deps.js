// Phase 10 (X2 CodeNode bridge, spec D5): optional dev-time assist that
// shells out to `dependency-cruiser` for file-level dependency
// auto-derivation. NEVER a runtime dependency - `rcf` carries a public
// zero-third-party-runtime-deps claim (Phase 9 D14) that this module does
// not touch: it only ever invokes an external binary via child_process,
// only when the caller opts in with `--derive-deps`, and it never appears
// in package.json.
//
// PoC exp 3 evidence: dependency-cruiser beat hand-declaration at file
// level (8/8 agreement on hand-declared edges, plus 3 real edges the
// human missed - 73% human recall). Symbol-level derivation is out of
// reach for this tool (file-granular only, PoC-confirmed); symbol
// dependencies stay hand-declared or omitted (D5, out of scope SS6).
//
// `--no-install` on the npx invocation is load-bearing: this module must
// never trigger a network install as a side effect of a CLI flag. When
// the tool is not resolvable (no local install, npx would need to
// fetch it), the caller gets a helpful error, not a silent hang or a
// surprise download.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const NOT_RESOLVABLE_MESSAGE =
  'dependency-cruiser is not resolvable (no local install, and npx --no-install will not fetch it). '
  + 'Install it as a dev dependency in this project (npm install --save-dev dependency-cruiser) to use '
  + '--derive-deps, or declare --deps by hand.';

/**
 * Derive the file-level dependencies of `filePath` (repo-relative, no
 * `#symbol` suffix) via `dependency-cruiser`. Resolved locally or via
 * `npx --no-install`; never attempts to install anything.
 *
 * @param {object} args
 * @param {string} args.projectRoot - absolute path to project root
 * @param {string} args.filePath - repo-relative source path (no #symbol)
 * @param {(cmd: string, cmdArgs: string[], opts: object) => Promise<{stdout: string}>} [args.exec]
 *   Injection seam for tests - defaults to the real child_process call.
 * @returns {Promise<{ ok: true, deps: string[] } | { ok: false, message: string }>}
 */
export async function deriveFileDeps({ projectRoot, filePath, exec = execFileAsync }) {
  let stdout;
  try {
    ({ stdout } = await exec('npx', ['--no-install', 'dependency-cruiser', '--output-type', 'json', filePath], {
      cwd: projectRoot,
    }));
  } catch {
    return { ok: false, message: NOT_RESOLVABLE_MESSAGE };
  }
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    return { ok: false, message: `dependency-cruiser produced unparseable output: ${err.message}` };
  }
  const modules = Array.isArray(parsed?.modules) ? parsed.modules : [];
  const self = modules.find((m) => m.source === filePath);
  const deps = (self?.dependencies ?? [])
    .filter((d) => d.resolved && d.dependencyTypes?.every((t) => t !== 'npm' && t !== 'core'))
    .map((d) => d.resolved)
    .sort();
  return { ok: true, deps: [...new Set(deps)] };
}

/**
 * Map derived file-level dependency paths to existing Code Node ids
 * whose `path` (file part, ignoring any `#symbol` suffix) matches. A
 * derived file with no matching CN cannot become a dependency edge (D3:
 * `dependencies[]` is CN -> CN, not CN -> bare file) - such files are
 * reported separately so the caller can surface them informationally.
 *
 * @param {object} tree - walker TreeModel
 * @param {string[]} filePaths
 * @returns {{ cnIds: string[], unmatched: string[] }}
 */
export function mapDerivedDepsToCnIds(tree, filePaths) {
  const cnIds = new Set();
  const unmatched = [];
  for (const filePath of filePaths) {
    const matches = (tree.codeNodes ?? [])
      .filter((cn) => (cn.path ?? '').split('#')[0] === filePath)
      .map((cn) => cn.cnId)
      .sort();
    if (matches.length === 0) {
      unmatched.push(filePath);
    } else {
      for (const id of matches) cnIds.add(id);
    }
  }
  return { cnIds: [...cnIds].sort(), unmatched };
}
