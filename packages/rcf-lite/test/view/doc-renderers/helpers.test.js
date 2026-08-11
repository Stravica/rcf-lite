import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  anchorIdFor,
  brokenBanner,
  brokenReferenceSection,
  detailsWrap,
  docLink,
  docLinkList,
  escapeHtml,
  fieldList,
  fieldPara,
  rawJsonDisclosure,
} from '../../../src/view/doc-renderers/helpers.js';

test('escapeHtml escapes the dangerous chars', () => {
  assert.equal(escapeHtml('<b>"a"</b>'), '&lt;b&gt;&quot;a&quot;&lt;/b&gt;');
  assert.equal(escapeHtml("a'b&c"), 'a&#39;b&amp;c');
});

test('escapeHtml renders null and undefined as empty', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});

test('anchorIdFor returns the raw doc id (Phase 3.2 D5)', () => {
  assert.equal(anchorIdFor('REQ-002'), 'REQ-002');
  assert.equal(anchorIdFor('US-201'), 'US-201');
  assert.equal(anchorIdFor('AC-201-1'), 'AC-201-1');
});

test('docLink renders an anchor to the raw id', () => {
  assert.equal(docLink('REQ-002'), '<a href="#REQ-002">REQ-002</a>');
  assert.equal(docLink('US-201', 'Story'), '<a href="#US-201">Story</a>');
});

test('docLinkList renders comma-separated links', () => {
  const out = docLinkList(['REQ-001', 'REQ-002']);
  assert.match(out, /REQ-001/);
  assert.match(out, /REQ-002/);
  assert.match(out, /, /);
});

test('docLinkList shows none when list is empty', () => {
  assert.match(docLinkList([]), /none/);
  assert.match(docLinkList(undefined), /none/);
});

test('fieldPara returns empty string for nullish values', () => {
  assert.equal(fieldPara('Label', null), '');
  assert.equal(fieldPara('Label', ''), '');
});

test('fieldPara escapes the value', () => {
  assert.match(fieldPara('Label', '<b>'), /&lt;b&gt;/);
});

test('fieldList returns empty for missing list', () => {
  assert.equal(fieldList('X', undefined), '');
  assert.equal(fieldList('X', []), '');
});

test('fieldList renders an unordered list', () => {
  const out = fieldList('Tags', ['a', 'b']);
  assert.match(out, /<h4>Tags<\/h4>/);
  assert.match(out, /<li>a<\/li>/);
  assert.match(out, /<li>b<\/li>/);
});

test('rawJsonDisclosure contains a details summary', () => {
  const out = rawJsonDisclosure('{ "a": 1 }', { a: 1 }, 'REQ-042');
  assert.match(out, /<details/);
  assert.match(out, /Show raw JSON/);
  assert.match(out, /&quot;a&quot;/);
});

test('rawJsonDisclosure carries a data-doc-id for state persistence (D13b)', () => {
  const out = rawJsonDisclosure('{}', {}, 'REQ-042');
  assert.match(out, /data-doc-id="REQ-042::raw"/);
});

test('rawJsonDisclosure falls back to "doc" when parent id is missing (D13b)', () => {
  const out = rawJsonDisclosure('{}', {});
  assert.match(out, /data-doc-id="doc::raw"/);
});

test('brokenBanner is empty for empty error list', () => {
  assert.equal(brokenBanner([]), '');
  assert.equal(brokenBanner(undefined), '');
});

test('brokenBanner contains aside with role=alert', () => {
  const out = brokenBanner([{ kind: 'validation', message: 'oops' }]);
  assert.match(out, /aside class="broken" role="alert"/);
  assert.match(out, /validation/);
  assert.match(out, /oops/);
});

test('brokenReferenceSection renders a stand-alone broken article', () => {
  const out = brokenReferenceSection('REQ-099');
  assert.match(out, /id="REQ-099"/);
  assert.match(out, /broken reference/);
});

test('detailsWrap emits a data-doc-id details block with summary and body', () => {
  const out = detailsWrap({ id: 'REQ-001', summary: 'REQ-001 - Title', className: 'doc-req-wrap', body: '<p>b</p>' });
  assert.match(out, /^<details/);
  assert.match(out, /data-doc-id="REQ-001"/);
  assert.match(out, /class="doc-details doc-req-wrap"/);
  assert.match(out, /<summary><span class="summary-label">REQ-001 - Title<\/span><\/summary>/);
  assert.match(out, /<p>b<\/p>/);
});

test('detailsWrap escapes the summary text', () => {
  const out = detailsWrap({ id: 'X', summary: '<b>xss</b>', className: 'x', body: '' });
  assert.match(out, /<summary><span class="summary-label">&lt;b&gt;xss&lt;\/b&gt;<\/span><\/summary>/);
});
