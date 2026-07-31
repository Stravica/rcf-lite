// Stage-3 UI baseline drift audit
// (ui-design-gate-0.7.0-spec §3.4, §7 mandate 1, mandate 3).
//
// Runs alongside the existing Track A test-theatre audit and emits
// findings on the same reviewAudit record under the `uiBaselineDrift`
// kind (schema-registered on `reviewAudit.testTheatreFindings[].kind`
// per rcf-schemas@0.4.0).
//
// Two deterministic checks in v1:
//   1. `noHexInViewFiles` (§7 mandate 1): any view file matches
//      /#[0-9a-fA-F]{3,8}\b/ while the baseline sets
//      `defaults.noHexInViewFiles: true`. Severity: block. Scope is
//      configurable via `uiBaseline.defaults.viewFileGlobs` (default
//      ["src/ui/**"], minus the themeTokensModule path).
//   2. `sharedLayoutImport` (§7 mandate 3): route files (default heuristic
//      src/routes/**) do NOT import the sharedLayoutModule declared on
//      the baseline. Severity: block.
//
// Both checks are opt-out-aware via `uiBaseline.operatorOptOuts[]`; the
// finding is still recorded (so the operator can see the drift), but
// severity demotes to `advisory` when the opt-out matches.
//
// The audit is a pure function of (fbs, uiBaseline, file listing +
// contents). Callers supply the file listing so tests can stub without
// touching disk.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * @typedef {import('./index.js').TestTheatreFinding} TestTheatreFinding
 */

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/;

/**
 * Run the UI-baseline drift audit on one FBS. Requires `uiBaseline`
 * present on the manifest; when absent, returns an empty list (the
 * baseline is the ruling, and no baseline means nothing to drift from
 * for this audit - coverage of that state lives elsewhere).
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {object} args.fbs
 * @param {object|null} args.uiBaseline
 * @param {(patterns: string[]) => Promise<string[]>} args.listFiles  glob helper (injectable; project-root-relative paths returned)
 * @returns {Promise<TestTheatreFinding[]>}
 */
export async function auditUiBaselineDrift({ projectRoot, fbs, uiBaseline, listFiles }) {
  /** @type {TestTheatreFinding[]} */
  const findings = [];
  if (!uiBaseline || fbs?.uiBearing !== true) return findings;

  const defaults = uiBaseline.defaults ?? {};
  const optOuts = new Set((uiBaseline.operatorOptOuts ?? []).map((o) => o.field));

  // 1. noHexInViewFiles
  if (defaults.noHexInViewFiles === true) {
    const globs = Array.isArray(defaults.viewFileGlobs) && defaults.viewFileGlobs.length > 0
      ? defaults.viewFileGlobs
      : ['src/ui/**'];
    const tokensModule = typeof defaults.designTokensModule === 'string' ? defaults.designTokensModule : null;
    const files = await safeListFiles(listFiles, globs);
    for (const rel of files) {
      if (tokensModule && rel === tokensModule) continue;
      const abs = join(projectRoot, rel);
      let contents;
      try { contents = await readFile(abs, 'utf8'); } catch { continue; }
      const match = HEX_RE.exec(contents);
      if (match) {
        const severity = optOuts.has('noHexInViewFiles') ? 'advisory' : 'block';
        findings.push({
          tsId: fbs.fbsId, // schema requires tsId on findings; use the FBS id as anchor when no TS is involved
          kind: 'uiBaselineDrift',
          detail: `hex literal ${match[0]} detected in ${rel} (baseline defaults.noHexInViewFiles: true). Move colours into ${tokensModule ?? 'the design tokens module'}.`,
          severity,
        });
      }
    }
  }

  // 2. sharedLayoutImport
  if (typeof defaults.sharedLayoutModule === 'string' && defaults.sharedLayoutModule.length > 0) {
    const routeGlobs = Array.isArray(defaults.routeFileGlobs) && defaults.routeFileGlobs.length > 0
      ? defaults.routeFileGlobs
      : ['src/routes/**'];
    const layoutModule = defaults.sharedLayoutModule;
    const layoutBase = basename(layoutModule).replace(/\.[jt]sx?$/, '');
    const files = await safeListFiles(listFiles, routeGlobs);
    for (const rel of files) {
      const abs = join(projectRoot, rel);
      let contents;
      try { contents = await readFile(abs, 'utf8'); } catch { continue; }
      // A route file is expected to import the shared layout module,
      // either by the module path or by the module basename. Both are
      // recognised; the check is a coarse heuristic, not a formal AST.
      const hasImport = contents.includes(layoutModule)
        || new RegExp(`\\b${escapeForRegExp(layoutBase)}\\b`).test(contents);
      if (!hasImport) {
        const severity = optOuts.has('sharedLayoutModule') ? 'advisory' : 'block';
        findings.push({
          tsId: fbs.fbsId,
          kind: 'uiBaselineDrift',
          detail: `${rel} does not import the shared layout module (${layoutModule}); baseline mandate 3 says every route uses one layout.`,
          severity,
        });
      }
    }
  }
  return findings;
}

async function safeListFiles(listFiles, patterns) {
  if (typeof listFiles !== 'function') return [];
  try {
    const raw = await listFiles(patterns);
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}

function basename(path) {
  const idx = String(path).lastIndexOf('/');
  return idx >= 0 ? String(path).slice(idx + 1) : String(path);
}

function escapeForRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
