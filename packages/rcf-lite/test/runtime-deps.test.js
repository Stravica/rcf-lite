import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Regression guard for the packaging bug where runtime imports (ajv,
// ajv-formats) were filed under devDependencies, so every `rcf` command died
// from a clean tarball install (`npm pack` + `npm install <tarball>` installs
// no devDeps). Statically scans every bare-specifier import in the runtime
// source shipped in the tarball (src/ + bin/, the graph reachable from
// bin/rcf.js) and asserts each imported package is declared in
// `dependencies` -- never `devDependencies`. Since the shared-core
// extraction, the store/validator's ajv + @stravica-ai/rcf-schemas imports
// live in @stravica-ai/rcf-lite-core; build's only runtime bare specifier
// is that core package (workspace:*).

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Recursively collect .js file paths under a directory. */
function collectJsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectJsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

/** Extract module specifiers from static import/export-from and literal dynamic import(). */
function extractSpecifiers(source) {
  const specs = [];
  const patterns = [
    /(?:^|\n)\s*import\s+[^;'"]*?from\s*['"]([^'"]+)['"]/g, // import x from 'spec'
    /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g, //                 import 'spec' (side-effect)
    /(?:^|\n)\s*export\s+[^;'"]*?from\s*['"]([^'"]+)['"]/g, // export { x } from 'spec'
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g, //                  import('spec')
  ];
  for (const re of patterns) {
    for (const match of source.matchAll(re)) specs.push(match[1]);
  }
  return specs;
}

/** Map a bare specifier to its package name ('ajv/dist/2020.js' -> 'ajv', '@s/p/sub' -> '@s/p'). */
function packageName(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

test('every runtime bare-specifier import is declared in dependencies, not devDependencies', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const dependencies = pkg.dependencies ?? {};
  const devDependencies = pkg.devDependencies ?? {};

  const files = [...collectJsFiles(join(ROOT, 'src')), ...collectJsFiles(join(ROOT, 'bin'))];
  assert.ok(files.length > 0, 'expected runtime source files under src/ and bin/');

  const runtimePackages = new Set();
  for (const file of files) {
    for (const specifier of extractSpecifiers(readFileSync(file, 'utf8'))) {
      // Relative/absolute imports resolve inside the tarball; node: builtins
      // need no declaration. Everything else must be an installed package.
      if (specifier.startsWith('.') || specifier.startsWith('/')) continue;
      if (specifier.startsWith('node:')) continue;
      runtimePackages.add(packageName(specifier));
    }
  }

  // Sanity: the scan must see the known runtime packages, or the regex has
  // silently rotted and the guard is asserting on an empty set.
  for (const known of ['@stravica-ai/rcf-lite-core']) {
    assert.ok(runtimePackages.has(known), `scan lost known runtime package ${known}`);
  }

  for (const name of [...runtimePackages].sort()) {
    assert.ok(
      name in dependencies,
      `runtime import '${name}' missing from package.json dependencies -- clean tarball installs will fail`,
    );
    assert.ok(
      !(name in devDependencies),
      `runtime import '${name}' must not also appear in devDependencies`,
    );
  }
});
