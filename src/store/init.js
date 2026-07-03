// Project scaffolding. Creates a minimum valid rcf/ tree (manifest plus a
// placeholder PRD, REQ, US, TAD, TAC, ADR, BS, FBS) so a fresh repo has a
// schema-clean starting point. Every required field carries a TODO marker
// so the owner can see what they need to fill in.
//
// AC-101-2: refuses to overwrite an existing project. If rcf/manifest.json
// already exists, this function writes nothing and returns a usage error.
//
// Phase 3.7 D14 shape: parent-child edges live on the child. The PRD
// no longer carries `requirementIds`; each REQ carries `prdId` (already
// present). The TAD no longer carries `componentIds` /
// `architecturalDecisionIds`; each TAC / ADR carries `tadId`. The BS
// no longer carries `fbs[]`; each FBS carries `bsId`, `buildOrder`,
// `executionStatus` and `dependsOnFbsIds`. The empty `rcf/test-suites/`
// directory is scaffolded so a future authored TS drops into a
// pre-existing shape.
//
// Phase 4 D5: `seed` accepts overrides for the four interactive prompts
// (`prdProblemStatement`, `reqTitle`, `usTitle`, and any of the values
// the interactive `rcf init` UX collects). When `seed.interactive` is
// truthy the ADR-001 template starts in `draft` rather than `proposed`,
// matching interactive-mode intent (D22 amendment).

import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { rcfError } from '../errors/index.js';

const TIMESTAMP = '2026-01-01T00:00:00Z';

function manifestTemplate(projectName) {
  return {
    version: '2.0.0',
    projectName,
    description: 'RCF project manifest. Roots are declared here; children are walked from the roots.',
    prd: { id: 'PRD-001', path: 'prd.json' },
    tad: { id: 'TAD-001', path: 'tad.json' },
    bs: { id: 'BS-001', path: 'build-sequence.json' },
  };
}

function prdTemplate(projectName, seed) {
  return {
    prdId: 'PRD-001',
    productName: projectName,
    version: '0.1.0',
    status: 'draft',
    problemStatement: seed?.prdProblemStatement ?? 'TODO: state the problem this product solves.',
    objectives: seed?.prdProblemStatement
      ? [seed.prdProblemStatement]
      : ['TODO: add at least one objective.'],
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  };
}

function reqTemplate(seed) {
  return {
    reqId: 'REQ-001',
    prdId: 'PRD-001',
    title: seed?.reqTitle ?? 'TODO: name this requirement',
    description: seed?.reqTitle ?? 'TODO: describe this requirement.',
    category: 'functional',
    domain: 'todo',
    priority: 'must',
    version: '0.1.0',
    status: 'draft',
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  };
}

function userStoryTemplate(seed) {
  const interactive = Boolean(seed?.interactive);
  return {
    usId: 'US-101',
    prdId: 'PRD-001',
    reqId: 'REQ-001',
    version: '0.1.0',
    status: 'draft',
    title: seed?.usTitle ?? 'TODO: name this user story',
    // Interactive mode leaves the As-a / I want / So that fields as
    // minimal "-" placeholders (schema requires minLength: 1 so an empty
    // string would fail validation; the spec's "empty is allowed"
    // claim on this field was inaccurate on inspection).
    asA: interactive ? '-' : 'TODO: name the user',
    iWant: interactive ? '-' : 'TODO: state the want',
    soThat: interactive ? '-' : 'TODO: state the value',
    acceptanceCriteria: [
      {
        id: 'AC-101-1',
        description: 'TODO: describe the first acceptance criterion',
        testable: true,
      },
    ],
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  };
}

function tadTemplate() {
  return {
    tadId: 'TAD-001',
    prdId: 'PRD-001',
    version: '0.1.0',
    status: 'draft',
    systemOverview: {
      executiveSummary: 'TODO: one-paragraph system overview.',
      systemPurpose: 'TODO: state the system purpose.',
      architecturalApproach: 'TODO: state the architectural approach.',
      keyCapabilities: ['TODO: list at least one key capability.'],
    },
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  };
}

function tacTemplate() {
  return {
    tacId: 'TAC-001',
    prdId: 'PRD-001',
    tadId: 'TAD-001',
    version: '0.1.0',
    status: 'draft',
    name: 'TODO: name this component',
    purpose: 'TODO: state the purpose of this component.',
    responsibilities: ['TODO: list at least one responsibility.'],
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  };
}

function adrTemplate(seed) {
  return {
    adrId: 'ADR-001',
    prdId: 'PRD-001',
    tadId: 'TAD-001',
    version: '0.1.0',
    // Interactive-mode `rcf init` seeds ADR-001 in `draft`
    // (Phase 3.7 D2 grew the enum; Phase 4 D22 uses it here);
    // non-interactive mode keeps the historical `proposed` value.
    status: seed?.interactive ? 'draft' : 'proposed',
    title: 'TODO: name this architectural decision',
    context: 'TODO: describe the context.',
    decision: 'TODO: describe the decision.',
    consequences: 'TODO: describe the consequences.',
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  };
}

function buildSequenceTemplate() {
  return {
    bsId: 'BS-001',
    prdId: 'PRD-001',
    version: '0.1.0',
    status: 'draft',
    title: 'Initial build sequence',
    buildPhilosophy: 'TODO: describe the build philosophy.',
    generationStrategy: 'dependencyFirst',
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  };
}

function fbsTemplate() {
  return {
    fbsId: 'FBS-001',
    prdId: 'PRD-001',
    bsId: 'BS-001',
    buildOrder: 1,
    executionStatus: 'notStarted',
    title: 'TODO: name this build session',
    summary: 'TODO: describe what this build session delivers.',
    acIds: ['AC-101-1'],
    dependsOnFbsIds: [],
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  };
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return false;
    throw err;
  }
}

async function writeJson(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

/**
 * Scaffold a minimum valid rcf/ tree at `projectRoot`. Idempotent against an
 * empty target; refuses if rcf/manifest.json already exists.
 *
 * @param {object} args
 * @param {string} args.projectRoot - absolute path; created if missing
 * @param {string} [args.projectName] - written into manifest and PRD
 * @param {object} [args.seed] - optional interactive-mode overrides
 * @param {boolean} [args.seed.interactive]
 * @param {string} [args.seed.prdProblemStatement]
 * @param {string} [args.seed.reqTitle]
 * @param {string} [args.seed.usTitle]
 * @returns {Promise<{ created: string[] } | import('../errors/index.js').RcfError>}
 */
export async function initProject({ projectRoot, projectName = 'New RCF Project', seed = null }) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
    return rcfError({
      kind: 'usage',
      message: 'initProject requires projectRoot',
    });
  }
  const manifestPath = join(projectRoot, 'rcf', 'manifest.json');
  if (await exists(manifestPath)) {
    return rcfError({
      kind: 'usage',
      message: 'An RCF project already exists at this path (rcf/manifest.json present)',
      filePath: 'rcf/manifest.json',
    });
  }
  const dirs = [
    'rcf',
    'rcf/requirements',
    'rcf/user-stories',
    'rcf/tacs',
    'rcf/adrs',
    'rcf/fbs',
    'rcf/test-suites',
  ];
  for (const d of dirs) {
    await mkdir(join(projectRoot, d), { recursive: true });
  }

  const files = [
    ['rcf/manifest.json', manifestTemplate(projectName)],
    ['rcf/prd.json', prdTemplate(projectName, seed)],
    ['rcf/requirements/req-001.json', reqTemplate(seed)],
    ['rcf/user-stories/us-101.json', userStoryTemplate(seed)],
    ['rcf/tad.json', tadTemplate()],
    ['rcf/tacs/tac-001.json', tacTemplate()],
    ['rcf/adrs/adr-001.json', adrTemplate(seed)],
    ['rcf/build-sequence.json', buildSequenceTemplate()],
    ['rcf/fbs/fbs-001.json', fbsTemplate()],
  ];
  for (const [relPath, data] of files) {
    await writeJson(join(projectRoot, relPath), data);
  }

  return { created: files.map(([p]) => p) };
}
