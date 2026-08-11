// Register-canary runner (spec §7.4).
//
// Runs one fixture (or the whole pack) against a subagent driver,
// grades the response with core's REGISTER_CANARY_DIMENSIONS_V1, and
// composes the record shape for the fixture manifest.
//
// Subagent driver: injected. The default is a mock that returns a
// clean "in hand, next step is X" message, but the runner FORCES a
// mock run to be distinguishable from a real subagent run in the
// durable record — a mock never produces a pass verdict indistinguishable
// from a live one. Concretely:
//   - the runner takes a `driverMode` argument ('mock' | 'live');
//   - a mock run suffixes `buildVersion` with `-mockdriver` so the
//     mode marker travels with the record into any chain manifest a
//     downstream consumer could copy the record into (§7.4 fixture
//     manifest is not chain-validated, but the record shape must stay
//     honest across surfaces);
//   - a mock run OVERRIDES the top-level verdict to `fail` regardless
//     of grade, and populates `shipDespiteFailReason` with a plain
//     "mock canary driver — infrastructure test only, no real subagent
//     dispatched" line, so the record is durably marked as machinery
//     verification rather than a release gate.
// This mirrors Track A N-2 (unwired mutation runner returning PASS is
// theatre) and Track B flagged-call-2 (stub browser driver forced to
// warn-never-pass): unwired drivers must not produce clean-pass records.
// The production driver (Anthropic Agent SDK, Opus 4.7 per estate
// ladder) invokes with `driverMode: 'live'` and the overlay is skipped
// entirely — the record is a genuine grader output.

import { gradeResponse } from '@stravica-ai/rcf-lite-core/patterns/register-canary';

import { composeCanaryRecord } from './record-writer.js';

/**
 * Marker text applied to a mock-driver record's `shipDespiteFailReason`.
 * Deliberately long enough to satisfy the schema `minLength: 1` and
 * explicit enough that a reviewer greps the record and sees the mode.
 */
export const MOCK_DRIVER_MARKER = 'mock canary driver used; no real subagent was dispatched. This record verifies canary infrastructure only, not the register itself.';

/**
 * Suffix appended to `buildVersion` when the driver mode is mock. Ports
 * across surfaces (the fixture manifest is a private greppable log
 * today; a future ship into a chain manifest would carry the marker
 * intact through the schema-legal buildVersion string).
 */
export const MOCK_DRIVER_BUILD_VERSION_SUFFIX = '-mockdriver';

/**
 * @typedef {object} CanaryDriverInput
 * @property {string} operatorPrompt
 * @property {Array<{ path: string, content: string }>} supportingArtefacts
 * @property {string[]} grantedPermissions
 * @property {string} guidance                  the shipping playbook content injected as system context
 * @property {string} fixtureId
 */

/**
 * @typedef {object} CanaryDriverOutput
 * @property {string} responseBody              the first-response body text (system prompts / tool-use excluded)
 */

/**
 * @typedef {(input: CanaryDriverInput) => Promise<CanaryDriverOutput>} CanaryDriver
 */

/**
 * A clean-register mock driver. Produces a short, on-register reply
 * that passes every graded dimension. Used by tests and by the CLI
 * when no live driver is wired.
 *
 * @type {CanaryDriver}
 */
export async function MOCK_SUBAGENT() {
  return {
    responseBody: "Have it in hand. The brief points at a single-operator uptime tool with an admin surface and email recovery pings. Two open decisions before any code: which host you want to deploy against, and the credential store for Resend. Once you name those I will scaffold the tree and hand you the first build item.",
  };
}

/**
 * Run one fixture against a driver and produce a record.
 *
 * @param {object} args
 * @param {object} args.fixture
 * @param {CanaryDriver} args.driver
 * @param {'mock'|'live'} args.driverMode           mock runs are overridden to fail; see file header
 * @param {string} args.buildVersion
 * @param {string} args.guidance
 * @param {object[]} args.existingRecords
 * @param {Date} [args.now]
 * @returns {Promise<{ record: object, responseBody: string }>}
 */
export async function runCanaryAgainstFixture({ fixture, driver, driverMode, buildVersion, guidance, existingRecords, now }) {
  if (driverMode !== 'mock' && driverMode !== 'live') {
    throw new Error(`runCanaryAgainstFixture: driverMode must be 'mock' or 'live' (got ${JSON.stringify(driverMode)})`);
  }
  const output = await driver({
    operatorPrompt: fixture.operatorPrompt,
    supportingArtefacts: fixture.supportingArtefacts ?? [],
    grantedPermissions: fixture.grantedPermissions ?? [],
    guidance,
    fixtureId: fixture.id,
  });
  const grade = gradeResponse({
    responseBody: output.responseBody,
    grantedPermissions: fixture.grantedPermissions,
    wordCountBudget: fixture.wordCountBudget,
  });
  // A mock driver never produces a clean-pass record: suffix the
  // buildVersion, force the top-level verdict to `fail`, and stamp
  // shipDespiteFailReason with the mock-marker string. The `grades`
  // block still reflects what the mock actually said, so a reader can
  // see the pattern-level detail — the aggregate is what is forced.
  const effectiveBuildVersion = driverMode === 'mock' ? `${buildVersion}${MOCK_DRIVER_BUILD_VERSION_SUFFIX}` : buildVersion;
  const effectiveGrade = driverMode === 'mock' ? { verdict: 'fail', grades: grade.grades } : grade;
  const record = composeCanaryRecord({
    existingRecords,
    buildVersion: effectiveBuildVersion,
    fixturePromptId: fixture.id,
    responseBody: output.responseBody,
    grade: effectiveGrade,
    shipDespiteFailReason: driverMode === 'mock' ? MOCK_DRIVER_MARKER : undefined,
    now,
  });
  return { record, responseBody: output.responseBody };
}

/**
 * Run every fixture in the pack. Returns the records in run order plus
 * an aggregate verdict (any fail forces aggregate fail).
 *
 * @param {object} args
 * @param {object[]} args.fixtures
 * @param {CanaryDriver} args.driver
 * @param {'mock'|'live'} args.driverMode
 * @param {string} args.buildVersion
 * @param {string} args.guidance
 * @param {object[]} args.existingRecords
 * @param {Date} [args.now]
 * @returns {Promise<{ records: object[], verdict: 'pass'|'fail', driverMode: 'mock'|'live' }>}
 */
export async function runCanaryPack({ fixtures, driver, driverMode, buildVersion, guidance, existingRecords, now }) {
  const records = [];
  let aggregate = 'pass';
  let existing = [...existingRecords];
  for (const fixture of fixtures) {
    // eslint-disable-next-line no-await-in-loop
    const { record } = await runCanaryAgainstFixture({
      fixture, driver, driverMode, buildVersion, guidance, existingRecords: existing, now,
    });
    records.push(record);
    existing = [...existing, record];
    if (record.verdict === 'fail') aggregate = 'fail';
  }
  return { records, verdict: aggregate, driverMode };
}
