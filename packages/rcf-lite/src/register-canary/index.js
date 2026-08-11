// Public surface for the register-canary runner (spec §7).

export { loadFixturePack, DEFAULT_FIXTURE_IDS } from './fixture-loader.js';
export {
  composeCanaryRecord,
  writeCanaryManifest,
  readCanaryManifest,
  DEFAULT_CANARY_MANIFEST_PATH,
} from './record-writer.js';
export { runCanaryAgainstFixture, runCanaryPack, MOCK_SUBAGENT } from './runner.js';
