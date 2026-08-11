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

// Track B review N-5 (2026-07-31, rcf-schemas 0.4.2): the drift finding
// anchors on the FBS id via the dedicated `anchorId` field, not by
// smuggling the id through the `tsId` slot. The check is important for
// two reasons: (1) downstream readers can no longer assume `tsId` names
// a real TS on drift findings; (2) the schema now forbids that legacy
// shape on new emissions if a caller wants a clean record (though
// pre-0.4.2 emissions with tsId set are still schema-valid for back-
// compat).

test('N-5: hex-literal uiBaselineDrift finding uses anchorId (not tsId) as the FBS anchor', async () => {
  const projectRoot = await makeProjectFiles({
    'src/ui/dashboard.ts': 'const bg = "#ff00aa";',
  });
  const findings = await auditUiBaselineDrift({
    projectRoot, fbs: uiBearingFbs, uiBaseline: baseline,
    listFiles: async (patterns) => {
      if (patterns.some((p) => p.startsWith('src/ui'))) return ['src/ui/dashboard.ts'];
      return [];
    },
  });
  const hex = findings.find((f) => /hex literal/.test(f.detail));
  assert.ok(hex, 'expected a hex-literal finding');
  assert.equal(hex.anchorId, 'FBS-016');
  assert.equal(hex.tsId, undefined, 'drift findings must not populate the tsId slot');
});

test('N-5: sharedLayoutImport uiBaselineDrift finding uses anchorId (not tsId) as the FBS anchor', async () => {
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
  assert.equal(findings[0].anchorId, 'FBS-016');
  assert.equal(findings[0].tsId, undefined, 'drift findings must not populate the tsId slot');
});

test('N-5: a drift-only reviewAudit record composed from these findings validates against the schema (no tsId required)', async () => {
  const { validateDocument } = await import('#core/store');
  const projectRoot = await makeProjectFiles({
    'src/ui/dashboard.ts': 'const bg = "#ff00aa";',
    'src/routes/dashboard.ts': 'export function DashboardPage() { return html("dash"); }',
  });
  const findings = await auditUiBaselineDrift({
    projectRoot, fbs: uiBearingFbs, uiBaseline: baseline,
    listFiles: async () => ['src/ui/dashboard.ts', 'src/routes/dashboard.ts'],
  });
  const manifest = {
    version: '2.0.0',
    projectName: 'N-5 smoke',
    prd: { id: 'PRD-001', path: 'prd.json' },
    tad: { id: 'TAD-001', path: 'tad.json' },
    bs:  { id: 'BS-001',  path: 'build-sequence.json' },
    reviewAudit: [{
      id: 'ra-FBS-016-1',
      fbsId: 'FBS-016',
      createdAt: '2026-07-31T15:00:00Z',
      testTheatreFindings: findings,
      verdict: 'block',
    }],
  };
  const err = validateDocument({ doc: manifest, kind: 'manifest', filePath: 'rcf/manifest.json' });
  assert.equal(err, null, `manifest with drift-only findings should validate; got ${JSON.stringify(err)}`);
});
