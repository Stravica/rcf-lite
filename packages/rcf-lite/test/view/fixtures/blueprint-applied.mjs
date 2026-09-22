// Fixture: a small BuiltTreeModel with one applied blueprint contributing
// two namespaced REQs plus two project-authored REQs. Feeds the Product
// Map by-blueprint grouping tests (TS-213 / AC-17008-1). Kept as an
// in-memory tree-model shape rather than an on-disk rcf/ tree so the
// assertions target the pure rendering path without a walkTree round
// trip; the manifest.blueprints[].contributions[] shape matches the
// schema (0.4.4 addition, `appliedBlueprintRecord`).

/**
 * @returns {import('../../../src/view/tree-model.js').BuiltTreeModel}
 */
export function makeBlueprintAppliedModel() {
  const bpReq1 = {
    reqId: 'my-auth-REQ-001',
    prdId: 'PRD-001',
    title: 'Login screen',
    status: 'draft',
    tags: ['capability:auth-flow'],
    shapeClassification: { shapes: ['webUi'], reason: 'test-fixture', classifiedAt: '2026-09-22T00:00:00Z' },
  };
  const bpReq2 = {
    reqId: 'my-auth-REQ-002',
    prdId: 'PRD-001',
    title: 'Password rotation policy',
    status: 'approved',
    tags: ['capability:auth-flow', 'capability:policy'],
    shapeClassification: { shapes: ['none'], reason: 'test-fixture', classifiedAt: '2026-09-22T00:00:00Z' },
  };
  const projReq1 = {
    reqId: 'REQ-001',
    prdId: 'PRD-001',
    title: 'Home dashboard tiles',
    status: 'draft',
    tags: ['capability:dashboard'],
    shapeClassification: { shapes: ['webUi'], reason: 'test-fixture', classifiedAt: '2026-09-22T00:00:00Z' },
  };
  const projReq2 = {
    reqId: 'REQ-002',
    prdId: 'PRD-001',
    title: 'Public API rate limiting',
    status: 'review',
    tags: ['capability:api'],
    shapeClassification: { shapes: ['httpApi'], reason: 'test-fixture', classifiedAt: '2026-09-22T00:00:00Z' },
  };
  const requirements = [bpReq1, bpReq2, projReq1, projReq2];
  const manifest = {
    version: '2.0.0',
    projectName: 'Blueprint applied fixture',
    prd: { id: 'PRD-001', path: 'prd.json' },
    tad: { id: 'TAD-001', path: 'tad.json' },
    bs: { id: 'BS-001', path: 'build-sequence.json' },
    blueprints: [
      {
        slug: 'my-auth',
        version: '1.0.0',
        appliedAt: '2026-09-22T00:00:00Z',
        source: 'my-auth',
        contributions: [
          { id: 'my-auth-REQ-001', kind: 'req', path: 'rcf/requirements/my-auth-req-001.json' },
          { id: 'my-auth-REQ-002', kind: 'req', path: 'rcf/requirements/my-auth-req-002.json' },
        ],
      },
    ],
  };
  return {
    manifest,
    prd: null,
    tad: null,
    bs: null,
    requirements,
    userStories: [],
    tacs: [],
    adrs: [],
    fbsItems: [],
    testSuites: [],
    byId: new Map(requirements.map((r) => [r.reqId, r])),
    rawById: new Map(requirements.map((r) => [r.reqId, JSON.stringify(r, null, 2)])),
    brokenIds: new Set(),
    parentByChild: new Map(),
    childrenByParent: new Map(),
    dependentsByFbsId: new Map(),
    tsByAcId: new Map(),
    tcsByAcId: new Map(),
    usByTacId: new Map(),
    storiesByReqId: new Map(),
    fbsByAcId: new Map(),
    acIdsByUsId: new Map(),
    usByAcId: new Map(),
    errorsById: new Map(),
    errors: [],
    codeNodes: [],
    cnByAcId: new Map(),
  };
}

/**
 * A companion fixture with an empty blueprints array (project with no
 * applied blueprints), so the by-blueprint grouping degenerates to a
 * single Project bucket.
 *
 * @returns {import('../../../src/view/tree-model.js').BuiltTreeModel}
 */
export function makeNoBlueprintsAppliedModel() {
  const requirements = [
    {
      reqId: 'REQ-001',
      prdId: 'PRD-001',
      title: 'Project without applied blueprints',
      status: 'draft',
      tags: ['capability:dashboard'],
      shapeClassification: { shapes: ['webUi'], reason: 'test-fixture', classifiedAt: '2026-09-22T00:00:00Z' },
    },
  ];
  return {
    manifest: {
      version: '2.0.0',
      projectName: 'No blueprints applied',
      prd: { id: 'PRD-001', path: 'prd.json' },
      tad: { id: 'TAD-001', path: 'tad.json' },
      bs: { id: 'BS-001', path: 'build-sequence.json' },
      blueprints: [],
    },
    prd: null,
    tad: null,
    bs: null,
    requirements,
    userStories: [],
    tacs: [],
    adrs: [],
    fbsItems: [],
    testSuites: [],
    byId: new Map(requirements.map((r) => [r.reqId, r])),
    rawById: new Map(requirements.map((r) => [r.reqId, JSON.stringify(r, null, 2)])),
    brokenIds: new Set(),
    parentByChild: new Map(),
    childrenByParent: new Map(),
    dependentsByFbsId: new Map(),
    tsByAcId: new Map(),
    tcsByAcId: new Map(),
    usByTacId: new Map(),
    storiesByReqId: new Map(),
    fbsByAcId: new Map(),
    acIdsByUsId: new Map(),
    usByAcId: new Map(),
    errorsById: new Map(),
    errors: [],
    codeNodes: [],
    cnByAcId: new Map(),
  };
}
