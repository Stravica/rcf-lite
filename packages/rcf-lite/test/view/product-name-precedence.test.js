// Project display name precedence (issue 295, w-2026-10-06-dave-001).
// Dex (WSD) could not change the audit header's display name without
// hand-editing manifest.json: `rcf define update MANIFEST` is not
// addressable, so manifest.projectName is a one-shot init value. The
// lite-native cut flips the precedence: the header prefers
// prd.productName when the PRD carries one and falls back to the
// manifest value. The manifest keeps owning ids / paths; this is a
// display-only change.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderPage, resolveProductHeader } from '../../src/view/html-page.js';

function emptyModel(over = {}) {
  return {
    manifest: null,
    prd: null,
    tad: null,
    bs: null,
    requirements: [],
    userStories: [],
    tacs: [],
    adrs: [],
    fbsItems: [],
    testSuites: [],
    byId: new Map(),
    rawById: new Map(),
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
    ...over,
  };
}

test('AC-202-6: prd.productName wins over manifest.projectName when both are set', () => {
  const header = resolveProductHeader(emptyModel({
    manifest: { projectName: 'the-manifest-id-slug' },
    prd: { productName: 'WESPA - WSD Enterprise Semantic Platform for Analytics' },
  }));
  assert.equal(
    header.projectName,
    'WESPA - WSD Enterprise Semantic Platform for Analytics',
    'the header must show prd.productName; manifest.projectName is kept for ids and paths',
  );
});

test('AC-202-6: manifest.projectName is the first fallback when PRD has no productName', () => {
  const header = resolveProductHeader(emptyModel({
    manifest: { projectName: 'From the manifest' },
    prd: { productName: null, productTitle: 'From the title' },
  }));
  assert.equal(header.projectName, 'From the manifest');
});

test('AC-202-6: prd.productTitle is the last fallback (brief-stage trees without productName or manifest)', () => {
  const header = resolveProductHeader(emptyModel({
    prd: { productTitle: 'The PRD title' },
  }));
  assert.equal(header.projectName, 'The PRD title');
});

test('AC-202-6: a PRD without a productName (undefined, not just empty) falls through to manifest', () => {
  const header = resolveProductHeader(emptyModel({
    manifest: { projectName: 'Manifest wins the fallback' },
    prd: {},
  }));
  assert.equal(header.projectName, 'Manifest wins the fallback');
});

test('AC-202-6: nothing set returns null, not an empty string', () => {
  const header = resolveProductHeader(emptyModel());
  assert.equal(header.projectName, null);
});

test('AC-202-6: renderPage reflects the flipped precedence in the DOM', () => {
  const html = renderPage(emptyModel({
    manifest: { projectName: 'manifest-slug' },
    prd: { productName: 'The Pretty Name' },
  }));
  assert.match(
    html,
    /<span class="name" title="The Pretty Name">The Pretty Name<\/span>/,
  );
  // The manifest value is not rendered as the display name even when it
  // is present (it still rides along in the raw-JSON dump, which is fine).
  const productIdx = html.indexOf('<div class="product">');
  const navIdx = html.indexOf('<nav class="tabs"');
  const headerSlice = html.slice(productIdx, navIdx);
  assert.doesNotMatch(
    headerSlice,
    /manifest-slug/,
    'manifest.projectName must not reach the header name span once PRD carries productName',
  );
});
