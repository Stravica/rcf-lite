// Stage-3 UI baseline drift audit tests (spec §3.4, §7 mandate 1, mandate 3).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { auditUiBaselineDrift } from '../../src/review/ui-baseline-drift.js';

async function makeProjectFiles(files) {
  const root = await mkdtemp(join(tmpdir(), 'rcf-uibd-'));
  for (const [rel, contents] of Object.entries(files)) {
    const abs = join(root, rel);
    await mkdir(join(root, rel, '..'), { recursive: true });
    await writeFile(abs, contents);
  }
  return root;
}

function stubListFiles(files) {
  return async () => files;
}

const uiBearingFbs = { fbsId: 'FBS-016', uiBearing: true };
const baseline = {
  defaults: {
    noHexInViewFiles: true,
    designTokensModule: 'src/ui/tokens.ts',
    sharedLayoutModule: 'src/ui/layout.ts',
  },
};

test('audit returns empty when the FBS is not uiBearing', async () => {
  const findings = await auditUiBaselineDrift({
    projectRoot: '/nowhere', fbs: { fbsId: 'FBS-001' }, uiBaseline: baseline, listFiles: stubListFiles([]),
  });
  assert.deepEqual(findings, []);
});

test('audit returns empty when no uiBaseline is present', async () => {
  const findings = await auditUiBaselineDrift({
    projectRoot: '/nowhere', fbs: uiBearingFbs, uiBaseline: null, listFiles: stubListFiles([]),
  });
  assert.deepEqual(findings, []);
});

test('audit flags a hex literal in a view file as block-severity uiBaselineDrift', async () => {
  const projectRoot = await makeProjectFiles({
    'src/ui/dashboard.ts': 'const bg = "#ff00aa";',
    'src/ui/tokens.ts': 'export const brand = "any-value";', // ignored (tokens module)
  });
  // Scope this test to the hex-literal check only by giving the file
  // lister nothing for the routes-side glob.
  const findings = await auditUiBaselineDrift({
    projectRoot, fbs: uiBearingFbs, uiBaseline: baseline,
    listFiles: async (patterns) => {
      if (patterns.some((p) => p.startsWith('src/ui'))) return ['src/ui/dashboard.ts', 'src/ui/tokens.ts'];
      return [];
    },
  });
  const hex = findings.filter((f) => /hex literal/.test(f.detail));
  assert.equal(hex.length, 1);
  assert.equal(hex[0].kind, 'uiBaselineDrift');
  assert.equal(hex[0].severity, 'block');
  assert.match(hex[0].detail, /#ff00aa/);
});

test('audit demotes to advisory when noHexInViewFiles is opted out', async () => {
  const projectRoot = await makeProjectFiles({ 'src/ui/dashboard.ts': 'const bg = "#ff00aa";' });
  const baselineWithOptOut = { ...baseline, operatorOptOuts: [{ field: 'noHexInViewFiles', reason: 'x', operatorAckAt: 'x' }] };
  const findings = await auditUiBaselineDrift({
    projectRoot, fbs: uiBearingFbs, uiBaseline: baselineWithOptOut,
    listFiles: async (patterns) => {
      if (patterns.some((p) => p.startsWith('src/ui'))) return ['src/ui/dashboard.ts'];
      return [];
    },
  });
  const hex = findings.find((f) => /hex literal/.test(f.detail));
  assert.equal(hex.severity, 'advisory');
});

test('audit flags a route file that does not import the shared layout module', async () => {
  const projectRoot = await makeProjectFiles({
    'src/routes/dashboard.ts': 'export function DashboardPage() { return html("dash"); }',
  });
  const findings = await auditUiBaselineDrift({
    projectRoot, fbs: uiBearingFbs, uiBaseline: baseline,
    listFiles: async (patterns) => {
      if (patterns.some((p) => p.startsWith('src/routes'))) return ['src/routes/dashboard.ts'];
      return [];
    },
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, 'uiBaselineDrift');
  assert.match(findings[0].detail, /shared layout module/);
});

test('audit clears the sharedLayoutModule finding when the route imports the module', async () => {
  const projectRoot = await makeProjectFiles({
    'src/routes/dashboard.ts': 'import { layout } from "../ui/layout"; export function Dash() { return layout("dash"); }',
  });
  const findings = await auditUiBaselineDrift({
    projectRoot, fbs: uiBearingFbs, uiBaseline: baseline,
    listFiles: async (patterns) => {
      if (patterns.some((p) => p.startsWith('src/routes'))) return ['src/routes/dashboard.ts'];
      return [];
    },
  });
  assert.equal(findings.length, 0);
});
