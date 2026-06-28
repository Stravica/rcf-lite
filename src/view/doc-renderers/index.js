// Doc renderer index. Re-exports each per-type renderer so html-page.js can
// import them through a single module.

export { renderPrd } from './prd.js';
export { renderReq } from './req.js';
export { renderUserStory } from './user-story.js';
export { renderTad } from './tad.js';
export { renderTac } from './tac.js';
export { renderAdr } from './adr.js';
export { renderBuildSequence } from './build-sequence.js';
export { renderFbs } from './fbs.js';
export { renderTestSuite } from './test-suite.js';
