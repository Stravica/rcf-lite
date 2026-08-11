// Public surface for the REQ-shape classifier module (Track C+D §4).

export {
  classifyReq,
  mergeClassificationOntoReq,
  composeOperatorOverride,
} from './classifier.js';

export { classifyAndPersistReq } from './persist.js';
