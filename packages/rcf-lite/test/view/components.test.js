// Unit coverage for the viewer UI refresh PR 2 shared components.
// Each helper is a pure string builder; the tests pin the markup
// shape and the escaping behaviour. The fixture-page composition
// test lives alongside in components-fixture.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  renderBadge,
  renderDocRow,
  renderEmptyState,
  renderFilterBar,
  renderSubTabStrip,
  renderToastContainer,
} from '../../src/view/components/index.js';

// ---------------------------------------------------------------------
// DocRow
// ---------------------------------------------------------------------

test('DocRow: closed by default, carries data-doc-id matching the id', () => {
  const html = renderDocRow({ id: 'REQ-002', title: 'Hello', body: '<p>Body</p>' });
  assert.match(html, /^<details class="rcf-row doc-row"/);
  assert.doesNotMatch(html, /\sopen(\s|>)/);
  assert.match(html, /data-doc-id="REQ-002"/);
  assert.match(html, /<span class="id">REQ-002<\/span>/);
  assert.match(html, /<span class="title">Hello<\/span>/);
  assert.match(html, /<div class="rcf-row-body body">\s*<p>Body<\/p>/);
});

test('DocRow: open=true applies the open attribute', () => {
  const html = renderDocRow({ id: 'REQ-003', title: 'Open me', body: '', open: true });
  assert.match(html, /<details class="rcf-row doc-row" data-doc-id="REQ-003" open>/);
});

test('DocRow: className is appended to the base classes', () => {
  const html = renderDocRow({ id: 'FBS-010', title: 'A spec', className: 'doc-fbs-wrap' });
  assert.match(html, /class="rcf-row doc-row doc-fbs-wrap"/);
});

test('DocRow: meta slot is rendered verbatim and omitted when empty', () => {
  const html = renderDocRow({ id: 'US-304', title: 'Story', meta: '<span class="x">pill</span>' });
  assert.match(html, /<span class="meta"><span class="x">pill<\/span><\/span>/);
  const plain = renderDocRow({ id: 'US-305', title: 'Story' });
  assert.doesNotMatch(plain, /class="meta"/);
});

test('DocRow: dataDocId override lets a row anchor on a child id (raw-JSON pattern)', () => {
  const html = renderDocRow({ id: 'REQ-002', title: 't', dataDocId: 'REQ-002::raw' });
  assert.match(html, /data-doc-id="REQ-002::raw"/);
});

test('DocRow: title is HTML-escaped', () => {
  const html = renderDocRow({ id: 'REQ-X', title: '<script>oops</script>' });
  assert.match(html, /&lt;script&gt;oops&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>oops<\/script>/);
});

// ---------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------

test('Badge: count variant is the default', () => {
  const html = renderBadge({ value: 7 });
  assert.match(html, /class="rcf-badge rcf-badge--count"/);
  assert.match(html, /<span class="rcf-badge-value">7<\/span>/);
  assert.doesNotMatch(html, /rcf-badge-label/);
});

test('Badge: label renders as a muted prefix', () => {
  const html = renderBadge({ value: 3, label: 'US' });
  assert.match(html, /<span class="rcf-badge-label">US<\/span>/);
  assert.match(html, /<span class="rcf-badge-value">3<\/span>/);
});

test('Badge: facet and accent variants map to CSS classes', () => {
  assert.match(renderBadge({ value: 'x', variant: 'facet' }), /rcf-badge--facet/);
  assert.match(renderBadge({ value: 'x', variant: 'accent' }), /rcf-badge--accent/);
});

test('Badge: unknown variant falls back to count', () => {
  const html = renderBadge({ value: 1, variant: 'bogus' });
  assert.match(html, /rcf-badge--count/);
});

test('Badge: title attribute is HTML-escaped and omitted when empty', () => {
  const html = renderBadge({ value: 'ok', title: 'He said "hi"' });
  assert.match(html, /title="He said &quot;hi&quot;"/);
  const plain = renderBadge({ value: 'ok' });
  assert.doesNotMatch(plain, /\stitle=/);
});

// ---------------------------------------------------------------------
// FilterBar
// ---------------------------------------------------------------------

test('FilterBar: hashKey is written as data-rcf-filterbar on the root', () => {
  const html = renderFilterBar({ hashKey: 'requirements' });
  assert.match(html, /^<div class="rcf-filterbar filterbar" data-rcf-filterbar="requirements">/);
});

test('FilterBar: text input carries value, placeholder and the filter-text class', () => {
  const html = renderFilterBar({
    hashKey: 'build',
    text: 'graph',
    placeholder: 'Search 87 specs',
  });
  assert.match(html, /<input type="search" class="rcf-filter-text" value="graph" placeholder="Search 87 specs">/);
});

test('FilterBar: selects render options and mark the current value selected', () => {
  const html = renderFilterBar({
    hashKey: 'arch',
    selects: [{
      key: 'status',
      label: 'Status',
      value: 'inProgress',
      options: [
        { value: '', label: 'Any' },
        { value: 'inProgress', label: 'In progress' },
      ],
    }],
  });
  assert.match(html, /data-filter-key="status"/);
  assert.match(html, /<option value="inProgress" selected>In progress<\/option>/);
  assert.match(html, /<option value="">Any<\/option>/);
});

test('FilterBar: toggles render a labelled checkbox with the filter-key attribute', () => {
  const html = renderFilterBar({
    hashKey: 'requirements',
    toggles: [{ key: 'needsWork', label: 'Needs work only', checked: true }],
  });
  assert.match(html, /<input type="checkbox" data-filter-key="needsWork" checked>/);
  assert.match(html, /<span>Needs work only<\/span>/);
});

test('FilterBar: count readout, when supplied, renders at the right', () => {
  const html = renderFilterBar({ hashKey: 'x', count: { visible: 11, total: 24 } });
  assert.match(html, /<span class="rcf-filter-count count">11 of 24 visible<\/span>/);
});

test('FilterBar: expand control is on by default and can be suppressed', () => {
  assert.match(renderFilterBar({ hashKey: 'x' }), /class="rcf-filter-expand linkish"/);
  assert.doesNotMatch(
    renderFilterBar({ hashKey: 'x', showExpandAll: false }),
    /class="rcf-filter-expand/,
  );
});

// ---------------------------------------------------------------------
// EmptyState
// ---------------------------------------------------------------------

test('EmptyState: title is required; hint and actionHtml are optional', () => {
  const html = renderEmptyState({ title: 'Nothing here' });
  assert.match(html, /class="rcf-empty-state empty" role="status"/);
  assert.match(html, /<p class="rcf-empty-state-title">Nothing here<\/p>/);
  assert.doesNotMatch(html, /rcf-empty-state-hint/);
  assert.doesNotMatch(html, /rcf-empty-state-action/);
});

test('EmptyState: hint is escaped, actionHtml is passed through verbatim', () => {
  const html = renderEmptyState({
    title: 'Empty',
    hint: '<em>plain text</em>',
    actionHtml: '<code>rcf init</code>',
  });
  assert.match(html, /rcf-empty-state-hint">&lt;em&gt;plain text&lt;\/em&gt;<\/p>/);
  assert.match(html, /rcf-empty-state-action"><code>rcf init<\/code>/);
});

// ---------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------

test('Toast container: single data-toast element, aria-live polite', () => {
  const html = renderToastContainer();
  assert.equal(
    html,
    '<output class="rcf-toast toast" aria-live="polite" aria-atomic="true" data-toast></output>',
  );
});

// ---------------------------------------------------------------------
// SubTabStrip
// ---------------------------------------------------------------------

test('SubTabStrip: items render as role=tab buttons; active is marked', () => {
  const html = renderSubTabStrip({
    hashKey: 'build',
    items: [{ key: 'specs', label: 'Specs' }, { key: 'dag', label: 'DAG' }],
    active: 'dag',
  });
  assert.match(html, /data-rcf-subtabstrip="build"/);
  assert.match(html, /role="tablist"/);
  assert.match(html, /<button type="button" role="tab" data-sub="specs" aria-selected="false">Specs<\/button>/);
  assert.match(html, /<button type="button" role="tab" data-sub="dag" aria-selected="true">DAG<\/button>/);
});

test('SubTabStrip: when active is unset, the first item is active', () => {
  const html = renderSubTabStrip({
    hashKey: 'build',
    items: [{ key: 'specs', label: 'Specs' }, { key: 'dag', label: 'DAG' }],
  });
  assert.match(html, /data-sub="specs" aria-selected="true"/);
  assert.match(html, /data-sub="dag" aria-selected="false"/);
});

test('SubTabStrip: aria-controls renders when a controls id is supplied', () => {
  const html = renderSubTabStrip({
    hashKey: 'build',
    items: [{ key: 'specs', label: 'Specs', controls: 'build-specs-panel' }],
  });
  assert.match(html, /aria-controls="build-specs-panel"/);
});
