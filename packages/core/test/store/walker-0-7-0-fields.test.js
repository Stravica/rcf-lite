// Walker surfacing tests for the 0.7.0 train (rcf-schemas@0.4.0).
//
// Core's job is to load every new manifest / FBS / REQ / US / TS field
// verbatim and pass them through `walkTree` output unchanged. NO derivation,
// NO AC-flattening, NO fbsUiBearing rollup - those live in verify's chain
// reader (per Track B §11.2 and the tonight's clarification: "walker
// surfacing only; derivation belongs to verify's chain reader").
//
// The three specs' core-side AC surface:
//   - Track A (verification-integrity-cluster-spec §8.2):
//       manifest.preFlightConfig[], manifest.reviewAudit[], manifest.testCommand;
//       fbs.dependsOnServices[]; ts.testCases[].runtimeProvenance
//   - Track B (ui-design-gate-0.7.0-spec §11.2):
//       manifest.uiBaseline, manifest.browserVerification[], manifest.uiBaselineHistory[];
//       fbs.uiBearing, uiClassification, designStage, designStageComplete
//   - Track C+D (elicitation-and-playbook-hardening-0.7.0 §13.2):
//       manifest.baselineAcOptOuts[], intakeClassification, registerCanary[], reviewSurface;
//       req.shapeClassification; us.acceptanceCriteria[].provenance
//
// AC coverage: one named test per surfaced field, plus the composite
// walker-loads-cleanly assertion.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initProject } from '../../src/store/init.js';
import { walkTree } from '../../src/store/walker.js';

const TIMESTAMP = '2026-07-30T14:20:00Z';

async function scaffold(name) {
  const root = await mkdtemp(join(tmpdir(), `rcf-walker-070-${name}-`));
  await initProject({ projectRoot: root, projectName: '070Train' });
  return root;
}

async function patchDoc(root, relPath, patch) {
  const path = join(root, 'rcf', relPath);
  const doc = JSON.parse(await readFile(path, 'utf8'));
  const merged = { ...doc, ...patch };
  await writeFile(path, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  return merged;
}

async function writeDoc(root, relPath, doc) {
  const path = join(root, 'rcf', relPath);
  await writeFile(path, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
}

// -- Track A: manifest.preFlightConfig[], reviewAudit[], testCommand ------

test('walker-A-01: surfaces manifest.preFlightConfig[] verbatim', async () => {
  const root = await scaffold('pfc');
  const preFlightConfig = [
    {
      id: 'pfc-2026-07-30-001',
      createdAt: TIMESTAMP,
      prdId: 'PRD-001',
      servicesInScope: [
        {
          id: 'resend',
          displayName: 'Resend email API',
          sourceRefs: ['PRD-001#external-integrations'],
          attestationMode: 'declaredMockOnly',
          credentialSupplied: false,
          sandboxProvisioned: false,
          operatorReason: 'no key available; ship blocker acknowledged - cannot enter deployed profile',
          affectedFbsIds: ['FBS-001'],
        },
      ],
      operatorAckAt: TIMESTAMP,
    },
  ];
  await patchDoc(root, 'manifest.json', { preFlightConfig });
  const { tree, errors } = await walkTree({ projectRoot: root });
  assert.deepEqual(errors, [], JSON.stringify(errors, null, 2));
  assert.deepEqual(tree.manifest.preFlightConfig, preFlightConfig);
});

test('walker-A-02: surfaces manifest.preFlightConfig[].designShapeAnswers[] (Track A addendum)', async () => {
  const root = await scaffold('pfc-dsa');
  const preFlightConfig = [
    {
      id: 'pfc-2026-07-30-002',
      createdAt: TIMESTAMP,
      prdId: 'PRD-001',
      servicesInScope: [],
      designShapeAnswers: [
        {
          questionId: 'auth.htmlLoginPage',
          reqId: 'REQ-001',
          answer: 'htmlLoginPage',
          answeredAt: TIMESTAMP,
        },
      ],
      operatorAckAt: TIMESTAMP,
    },
  ];
  await patchDoc(root, 'manifest.json', { preFlightConfig });
  const { tree, errors } = await walkTree({ projectRoot: root });
  assert.deepEqual(errors, [], JSON.stringify(errors, null, 2));
  assert.deepEqual(
    tree.manifest.preFlightConfig[0].designShapeAnswers,
    preFlightConfig[0].designShapeAnswers,
  );
});

test('walker-A-03: surfaces manifest.reviewAudit[] verbatim', async () => {
  const root = await scaffold('ra');
  const reviewAudit = [
    {
      id: 'ra-FBS-001-1',
      fbsId: 'FBS-001',
      createdAt: TIMESTAMP,
      testTheatreFindings: [
        {
          tsId: 'TS-001',
          tcId: 'TC-001-happy',
          kind: 'mockOnlyIntegrationClaim',
          detail: 'testLevel=integration but runtimeProvenance.profile=mock; AC binds attestationMode=live',
          severity: 'block',
        },
      ],
      verdict: 'block',
    },
  ];
  await patchDoc(root, 'manifest.json', { reviewAudit });
  const { tree, errors } = await walkTree({ projectRoot: root });
  assert.deepEqual(errors, [], JSON.stringify(errors, null, 2));
  assert.deepEqual(tree.manifest.reviewAudit, reviewAudit);
});

test('walker-A-04: surfaces manifest.testCommand verbatim', async () => {
  const root = await scaffold('tc');
  await patchDoc(root, 'manifest.json', { testCommand: 'pnpm -r test' });
  const { tree, errors } = await walkTree({ projectRoot: root });
  assert.deepEqual(errors, [], JSON.stringify(errors, null, 2));
  assert.equal(tree.manifest.testCommand, 'pnpm -r test');
});

test('walker-A-05: surfaces fbs.dependsOnServices[] verbatim (no derivation in core)', async () => {
  const root = await scaffold('deps');
  const dependsOnServices = [
    {
      id: 'resend',
      displayName: 'Resend email API',
      purpose: 'outbound transactional email delivery',
      attestationMode: 'live',
      acIds: ['AC-101-1'],
      preFlightRef: 'pfc-2026-07-30-001#services.resend',
    },
  ];
  await patchDoc(root, 'fbs/fbs-001.json', { dependsOnServices });
  const { tree, errors } = await walkTree({ projectRoot: root });
  assert.deepEqual(errors, [], JSON.stringify(errors, null, 2));
  assert.deepEqual(tree.fbsItems[0].dependsOnServices, dependsOnServices);
});

test('walker-A-06: surfaces ts.testCases[].runtimeProvenance verbatim', async () => {
  const root = await scaffold('rp');
  const ts = {
    id: 'TS-001',
    usId: 'US-101',
    title: 'email dispatcher happy path',
    purpose: 'confirm the dispatcher emits an email on the recovery event',
    testLevel: 'integration',
    acIds: ['AC-101-1'],
    testCases: [
      {
        id: 'TC-001-happy-path',
        acId: 'AC-101-1',
        description: 'email dispatched on recovery event',
        testPointer: 'test/email-dispatcher.test.ts::happy path',
        status: 'passing',
        runtimeProvenance: {
          profile: 'mock',
          envVarsRequired: [],
          externalHostsReached: [],
          notes: 'startHttpTestServer local fixture; no traffic to api.resend.com',
        },
      },
    ],
    status: 'draft',
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  };
  await writeDoc(root, 'test-suites/ts-001.json', ts);
  const { tree, errors } = await walkTree({ projectRoot: root });
  assert.deepEqual(errors, [], JSON.stringify(errors, null, 2));
  assert.equal(tree.testSuites.length, 1);
  assert.deepEqual(tree.testSuites[0].testCases[0].runtimeProvenance, ts.testCases[0].runtimeProvenance);
});

// -- Track B: manifest.uiBaseline, browserVerification[], uiBaselineHistory[]; fbs.uiBearing etc

test('walker-B-01: surfaces manifest.uiBaseline verbatim', async () => {
  const root = await scaffold('uib');
  const uiBaseline = {
    id: 'uib-2026-07-30-001',
    createdAt: TIMESTAMP,
    prdId: 'PRD-001',
    defaults: {
      themeMode: 'light-default-with-toggle',
      sharedLayoutModule: 'src/ui/layout.ts',
      designTokensModule: 'src/ui/tokens.ts',
      noHexInViewFiles: true,
      contrastTarget: 'WCAG AA',
      contrastTestBeforePalette: true,
      focusRingsRequired: true,
      hoverStatesRequired: true,
      componentVocabulary: {
        declaredComponents: ['Button', 'Input', 'Card', 'Badge', 'Table', 'Notice'],
        singleBadgeShape: true,
      },
      typography: {
        baseFontStack: 'system-ui',
        bodyLineHeight: 1.5,
        headingLineHeight: 1.25,
        proseMaxWidth: '72ch',
      },
      interactionDefaults: {
        loadingIndicatorOnFetch: true,
        disabledStateVisuallyDistinct: true,
      },
      authFlow: {
        htmlLoginPageRequired: true,
        smokeChecksRequired: true,
      },
    },
    operatorAckAt: TIMESTAMP,
  };
  await patchDoc(root, 'manifest.json', { uiBaseline });
  const { tree, errors } = await walkTree({ projectRoot: root });
  assert.deepEqual(errors, [], JSON.stringify(errors, null, 2));
  assert.deepEqual(tree.manifest.uiBaseline, uiBaseline);
});

test('walker-B-02: surfaces manifest.browserVerification[] verbatim', async () => {
  const root = await scaffold('bv');
  const browserVerification = [
    {
      id: 'bv-FBS-001-1',
      fbsId: 'FBS-001',
      createdAt: TIMESTAMP,
      mode: 'agentScreenshotCritique',
      runtimeProfile: 'local-dev',
      runtimeUrl: 'http://127.0.0.1:3000',
      routesChecked: [
        { path: '/', screenshotPath: '.rcf/artefacts/bv-FBS-001-1/light.png', themeApplied: 'light' },
      ],
      invariantChecks: [
        { invariant: 'sharedNavPresent', verdict: 'pass' },
      ],
      verdict: 'pass',
    },
  ];
  await patchDoc(root, 'manifest.json', { browserVerification });
  const { tree, errors } = await walkTree({ projectRoot: root });
  assert.deepEqual(errors, [], JSON.stringify(errors, null, 2));
  assert.deepEqual(tree.manifest.browserVerification, browserVerification);
});

test('walker-B-03: surfaces manifest.uiBaselineHistory[] verbatim (Track B §12 O-4)', async () => {
  const root = await scaffold('uibh');
  // Schema: each history entry is a full uiBaselineRecord (a superseded
  // ratified baseline). Empty-by-default; populated only when
  // `rcf ui-baseline init --reset` fires (§6.3).
  const uiBaselineHistory = [
    {
      id: 'uib-2026-06-01-001',
      createdAt: '2026-06-01T00:00:00Z',
      prdId: 'PRD-001',
      defaults: {
        themeMode: 'dark-default-with-toggle',
      },
      operatorAckAt: '2026-06-01T00:00:00Z',
    },
  ];
  await patchDoc(root, 'manifest.json', { uiBaselineHistory });
  const { tree, errors } = await walkTree({ projectRoot: root });
  assert.deepEqual(errors, [], JSON.stringify(errors, null, 2));
  assert.deepEqual(tree.manifest.uiBaselineHistory, uiBaselineHistory);
});

test('walker-B-04: surfaces fbs.uiBearing / uiClassification / designStage / designStageComplete', async () => {
  const root = await scaffold('fbs-ui');
  const patch = {
    uiBearing: true,
    uiClassification: {
      verdict: 'ui',
      reason: 'keyword-scan',
      signals: [
        { source: 'summary', match: 'dashboard' },
      ],
      classifiedAt: TIMESTAMP,
    },
    designStage: {
      journeys: [
        {
          id: 'signed-in-owner-checks-status',
          actor: 'signed-in owner',
          goal: 'see current status of every monitor at a glance',
          steps: ['lands on /', 'clicks monitor'],
        },
      ],
      navModel: {
        shape: 'shared-persistent',
        routes: [{ path: '/', label: 'Dashboard', authRequired: true }],
        signedInAsAffordance: true,
      },
      themeAndA11y: {
        themeMode: 'light-default-with-toggle',
        themeTokensModule: 'src/ui/tokens.ts',
        contrastTargets: 'WCAG AA (4.5 text, 3.0 large text, 3.0 UI component)',
        contrastTestPath: 'test/ui-accessibility.test.ts',
        contrastTestAuthoredBeforePalette: true,
      },
      authoredAt: TIMESTAMP,
      authoredBy: 'rcf-lite-engineer:design-worker',
    },
    designStageComplete: true,
  };
  await patchDoc(root, 'fbs/fbs-001.json', patch);
  const { tree, errors } = await walkTree({ projectRoot: root });
  assert.deepEqual(errors, [], JSON.stringify(errors, null, 2));
  const fbs = tree.fbsItems[0];
  assert.equal(fbs.uiBearing, true);
  assert.deepEqual(fbs.uiClassification, patch.uiClassification);
  assert.deepEqual(fbs.designStage, patch.designStage);
  assert.equal(fbs.designStageComplete, true);
});

// -- Track C+D: manifest.baselineAcOptOuts[], intakeClassification, registerCanary[], reviewSurface; req.shapeClassification; ac.provenance

test('walker-CD-01: surfaces manifest.baselineAcOptOuts[] verbatim', async () => {
  const root = await scaffold('boo');
  const baselineAcOptOuts = [
    {
      id: 'boo-2026-07-30-001',
      createdAt: TIMESTAMP,
      reqId: 'REQ-001',
      baselineKey: 'auth.htmlLoginPage',
      scope: 'req',
      reason: 'auth surface is API-only (SDK-driven clients only, no human browser flow); confirmed by preflight',
      operatorAckAt: TIMESTAMP,
      linkedPreFlightConfigRef: 'pfc-2026-07-30-001#services.auth',
    },
  ];
  await patchDoc(root, 'manifest.json', { baselineAcOptOuts });
  const { tree, errors } = await walkTree({ projectRoot: root });
  assert.deepEqual(errors, [], JSON.stringify(errors, null, 2));
  assert.deepEqual(tree.manifest.baselineAcOptOuts, baselineAcOptOuts);
});

test('walker-CD-02: surfaces manifest.intakeClassification verbatim', async () => {
  const root = await scaffold('ic');
  const intakeClassification = {
    id: 'ic-2026-07-30-001',
    createdAt: TIMESTAMP,
    fidelity: 'briefStrong',
    artefacts: [
      {
        path: 'docs/product-brief.md',
        kind: 'productBrief',
        wordCount: 3200,
        hash: 'sha256:8f4a0000000000000000000000000000000000000000000000000000000000',
        operatorSourced: true,
      },
    ],
    validationFindings: [],
    elicitationScope: {
      prdDrafted: 'supplied',
      reqDraftedFromArtefact: ['REQ-001'],
      reqRequiringElicitation: [],
      acsFromArtefact: 0,
      acsFromElicitation: 'all',
    },
    operatorAckAt: TIMESTAMP,
  };
  await patchDoc(root, 'manifest.json', { intakeClassification });
  const { tree, errors } = await walkTree({ projectRoot: root });
  assert.deepEqual(errors, [], JSON.stringify(errors, null, 2));
  assert.deepEqual(tree.manifest.intakeClassification, intakeClassification);
});

test('walker-CD-03: surfaces manifest.registerCanary[] verbatim', async () => {
  const root = await scaffold('rc');
  const registerCanary = [
    {
      id: 'rc-2026-07-30-001',
      createdAt: TIMESTAMP,
      buildVersion: '0.7.0-rc.1',
      fixturePromptId: 'canary-prompt-01',
      responseWordCount: 152,
      grades: {
        internalRuleCitation: { verdict: 'pass', matches: [] },
        unglossedJargon: { verdict: 'pass', matches: [] },
        redundantPermissionAsk: { verdict: 'pass', matches: [] },
        bypassOffer: { verdict: 'pass', matches: [] },
        wordCountBudget: { verdict: 'pass', target: 200, actual: 152 },
      },
      verdict: 'pass',
    },
  ];
  await patchDoc(root, 'manifest.json', { registerCanary });
  const { tree, errors } = await walkTree({ projectRoot: root });
  assert.deepEqual(errors, [], JSON.stringify(errors, null, 2));
  assert.deepEqual(tree.manifest.registerCanary, registerCanary);
});

test('walker-CD-04: surfaces manifest.reviewSurface verbatim', async () => {
  const root = await scaffold('rs');
  const reviewSurface = {
    viewServer: {
      mode: 'detached',
      startedAt: TIMESTAMP,
      socketPath: '.rcf/view.sock',
      pid: 42137,
      healthCheckPath: 'http://127.0.0.1:4373/healthz',
      lastHeartbeatAt: TIMESTAMP,
    },
  };
  await patchDoc(root, 'manifest.json', { reviewSurface });
  const { tree, errors } = await walkTree({ projectRoot: root });
  assert.deepEqual(errors, [], JSON.stringify(errors, null, 2));
  assert.deepEqual(tree.manifest.reviewSurface, reviewSurface);
});

test('walker-CD-05: surfaces req.shapeClassification verbatim', async () => {
  const root = await scaffold('sc');
  const shapeClassification = {
    shapes: ['webUi', 'auth'],
    reason: 'keyword-scan',
    signals: [
      { source: 'description', match: 'browser admin', shape: 'webUi' },
      { source: 'rationale', match: 'sign-in', shape: 'auth' },
    ],
    classifiedAt: TIMESTAMP,
  };
  await patchDoc(root, 'requirements/req-001.json', { shapeClassification });
  const { tree, errors } = await walkTree({ projectRoot: root });
  assert.deepEqual(errors, [], JSON.stringify(errors, null, 2));
  assert.equal(tree.requirements.length, 1);
  assert.deepEqual(tree.requirements[0].shapeClassification, shapeClassification);
});

test('walker-CD-06: surfaces ac.provenance verbatim through the US.acceptanceCriteria block', async () => {
  const root = await scaffold('acp');
  // Read current US, append a new AC with provenance, write back.
  const usPath = 'user-stories/us-101.json';
  const us = JSON.parse(await readFile(join(root, 'rcf', usPath), 'utf8'));
  us.acceptanceCriteria.push({
    id: 'AC-101-2',
    description: 'any authenticated route renders the shared nav',
    given: 'the user is signed in',
    when: 'any authenticated route is loaded',
    then: 'the response HTML contains the shared nav element with aria-current on the matching link',
    testable: true,
    provenance: {
      authoredBy: 'baseline',
      baselineKey: 'webUi.sharedNav',
      injectedAt: TIMESTAMP,
      sourceReqShape: 'webUi',
      acceptedByOperatorAt: TIMESTAMP,
    },
  });
  await writeDoc(root, usPath, us);
  const { tree, errors } = await walkTree({ projectRoot: root });
  assert.deepEqual(errors, [], JSON.stringify(errors, null, 2));
  const injectedAc = tree.userStories[0].acceptanceCriteria.find((ac) => ac.id === 'AC-101-2');
  assert.ok(injectedAc);
  assert.deepEqual(injectedAc.provenance, {
    authoredBy: 'baseline',
    baselineKey: 'webUi.sharedNav',
    injectedAt: TIMESTAMP,
    sourceReqShape: 'webUi',
    acceptedByOperatorAt: TIMESTAMP,
  });
});

// -- Composite: full tree loads cleanly with EVERY new field populated -----

test('walker-composite: a tree carrying every 0.7.0 additive field walks cleanly with zero errors', async () => {
  const root = await scaffold('composite');
  // Patch every additive field on a single tree so schema validation and
  // walker output are exercised together (matches the shape the 0.7.0
  // build/verify cars will produce end-to-end).
  await patchDoc(root, 'manifest.json', {
    preFlightConfig: [
      {
        id: 'pfc-2026-07-30-001',
        createdAt: TIMESTAMP,
        prdId: 'PRD-001',
        servicesInScope: [],
        designShapeAnswers: [],
        operatorAckAt: TIMESTAMP,
      },
    ],
    reviewAudit: [],
    testCommand: 'pnpm -r test',
    uiBaseline: {
      id: 'uib-2026-07-30-001',
      createdAt: TIMESTAMP,
      prdId: 'PRD-001',
      defaults: { themeMode: 'light-default-with-toggle' },
      operatorAckAt: TIMESTAMP,
    },
    browserVerification: [],
    uiBaselineHistory: [],
    baselineAcOptOuts: [],
    intakeClassification: {
      id: 'ic-2026-07-30-001',
      createdAt: TIMESTAMP,
      fidelity: 'briefStrong',
      artefacts: [],
      validationFindings: [],
      elicitationScope: {
        acsFromArtefact: 0,
      },
      operatorAckAt: TIMESTAMP,
    },
    registerCanary: [],
    reviewSurface: {
      viewServer: {
        mode: 'foreground',
        startedAt: TIMESTAMP,
        socketPath: '.rcf/view.sock',
        pid: 1,
        healthCheckPath: 'http://127.0.0.1:4373/healthz',
        lastHeartbeatAt: TIMESTAMP,
      },
    },
  });
  await patchDoc(root, 'requirements/req-001.json', {
    shapeClassification: {
      shapes: ['webUi'],
      reason: 'keyword-scan',
      signals: [{ source: 'description', match: 'dashboard', shape: 'webUi' }],
      classifiedAt: TIMESTAMP,
    },
  });
  await patchDoc(root, 'fbs/fbs-001.json', {
    uiBearing: true,
    uiClassification: {
      verdict: 'ui',
      reason: 'keyword-scan',
      signals: [{ source: 'summary', match: 'dashboard' }],
      classifiedAt: TIMESTAMP,
    },
    designStageComplete: false,
    dependsOnServices: [],
  });

  const { tree, errors } = await walkTree({ projectRoot: root });
  assert.deepEqual(errors, [], JSON.stringify(errors, null, 2));

  // All fields present.
  assert.ok(tree.manifest.preFlightConfig);
  assert.ok(tree.manifest.reviewAudit);
  assert.equal(tree.manifest.testCommand, 'pnpm -r test');
  assert.ok(tree.manifest.uiBaseline);
  assert.ok(tree.manifest.browserVerification);
  assert.ok(tree.manifest.uiBaselineHistory);
  assert.ok(tree.manifest.baselineAcOptOuts);
  assert.ok(tree.manifest.intakeClassification);
  assert.ok(tree.manifest.registerCanary);
  assert.ok(tree.manifest.reviewSurface);
  assert.ok(tree.requirements[0].shapeClassification);
  assert.equal(tree.fbsItems[0].uiBearing, true);
  assert.ok(tree.fbsItems[0].uiClassification);
  assert.equal(tree.fbsItems[0].designStageComplete, false);
  assert.ok(tree.fbsItems[0].dependsOnServices);
});

// -- Guard: no derivation added in core -----------------------------------

test('walker-guard: NO fbsUiBearing / serviceAttestations derivation added in core', async () => {
  // Per Track B §11.2 and the tonight's clarification (twin wording for
  // Track A serviceAttestations), core surfaces raw fields only. Any
  // aggregation lives in verify's chain reader. If a future edit adds a
  // derivation here, this guard flags it.
  const root = await scaffold('guard');
  await patchDoc(root, 'fbs/fbs-001.json', {
    uiBearing: true,
    dependsOnServices: [
      {
        id: 'resend', displayName: 'Resend', purpose: 'x',
        attestationMode: 'live', acIds: ['AC-101-1'],
      },
    ],
  });
  const { tree } = await walkTree({ projectRoot: root });
  // The flattened AC read-out for AC-101-1 is verify's job; nothing on
  // the tree top-level or userStories.acceptanceCriteria[] carries
  // fbsUiBearing or serviceAttestations here.
  for (const us of tree.userStories) {
    for (const ac of us.acceptanceCriteria ?? []) {
      assert.ok(!('fbsUiBearing' in ac), 'fbsUiBearing derivation leaked into core walker');
      assert.ok(!('serviceAttestations' in ac), 'serviceAttestations derivation leaked into core walker');
    }
  }
});
