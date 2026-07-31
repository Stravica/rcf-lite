// Parser tests for `rcf view start --persist-until <value>` (spec §9.2).
//
// The bug this parser fixes: the pre-fix supervisor called
// `Date.parse('4h')`, got NaN, refused to set a timer, and ran
// forever - a silent divergence from the spec's own sample
// (`--persist-until 4h`). These tests lock the new grammar and the
// garbage-refusal exit shape.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parsePersistUntil } from '../../src/view-supervisor/persist-until.js';

// Fixed clock so ISO conversions are reproducible. 2026-07-31 12:00:00Z.
const NOW_MS = Date.UTC(2026, 6, 31, 12, 0, 0);

test('duration `4h` (the spec §9.2 sample) parses to now + 4h ISO', () => {
  const result = parsePersistUntil('4h', { nowMs: NOW_MS });
  assert.equal(result.ok, true);
  assert.equal(result.source, 'duration');
  assert.equal(result.deadlineMs, NOW_MS + 4 * 60 * 60 * 1000);
  assert.equal(result.iso, '2026-07-31T16:00:00.000Z');
});

test('duration `30m` parses to now + 30 minutes ISO', () => {
  const result = parsePersistUntil('30m', { nowMs: NOW_MS });
  assert.equal(result.ok, true);
  assert.equal(result.source, 'duration');
  assert.equal(result.iso, '2026-07-31T12:30:00.000Z');
});

test('combined duration `2h30m` parses to now + 2h30m ISO', () => {
  const result = parsePersistUntil('2h30m', { nowMs: NOW_MS });
  assert.equal(result.ok, true);
  assert.equal(result.source, 'duration');
  assert.equal(result.iso, '2026-07-31T14:30:00.000Z');
});

test('duration `24h` parses to a full day added', () => {
  const result = parsePersistUntil('24h', { nowMs: NOW_MS });
  assert.equal(result.ok, true);
  assert.equal(result.iso, '2026-08-01T12:00:00.000Z');
});

test('ISO timestamp parses byte-verbatim to itself (normalised)', () => {
  const result = parsePersistUntil('2026-07-31T18:00:00Z', { nowMs: NOW_MS });
  assert.equal(result.ok, true);
  assert.equal(result.source, 'iso');
  assert.equal(result.iso, '2026-07-31T18:00:00.000Z');
});

test('ISO timestamp with millisecond precision round-trips', () => {
  const result = parsePersistUntil('2026-08-15T09:15:30.500Z', { nowMs: NOW_MS });
  assert.equal(result.ok, true);
  assert.equal(result.source, 'iso');
  assert.equal(result.iso, '2026-08-15T09:15:30.500Z');
});

test('past ISO timestamp is accepted (supervisor unwinds on next tick; parser is shape-only)', () => {
  const result = parsePersistUntil('2020-01-01T00:00:00Z', { nowMs: NOW_MS });
  assert.equal(result.ok, true);
  assert.equal(result.source, 'iso');
});

test('garbage `4hrs` refuses with the grammar in the error', () => {
  const result = parsePersistUntil('4hrs', { nowMs: NOW_MS });
  assert.equal(result.ok, false);
  assert.match(result.error, /--persist-until:/);
  assert.match(result.error, /4h/);
  assert.match(result.error, /ISO timestamp/);
});

test('garbage `foo` refuses with the grammar in the error', () => {
  const result = parsePersistUntil('foo', { nowMs: NOW_MS });
  assert.equal(result.ok, false);
  assert.match(result.error, /--persist-until:/);
  assert.match(result.error, /4h/);
  assert.match(result.error, /ISO timestamp/);
});

test('garbage `4 h` (space) refuses; the grammar is bare-token', () => {
  const result = parsePersistUntil('4 h', { nowMs: NOW_MS });
  assert.equal(result.ok, false);
  assert.match(result.error, /--persist-until:/);
});

test('empty string refuses', () => {
  const result = parsePersistUntil('', { nowMs: NOW_MS });
  assert.equal(result.ok, false);
  assert.match(result.error, /--persist-until:/);
});

test('non-string argument refuses (belt-and-braces vs argv corruption)', () => {
  const result = parsePersistUntil(null, { nowMs: NOW_MS });
  assert.equal(result.ok, false);
});

test('`0h` refuses (a zero-duration deadline is a wasted CLI call)', () => {
  const result = parsePersistUntil('0h', { nowMs: NOW_MS });
  assert.equal(result.ok, false);
  assert.match(result.error, /non-zero/);
});

test('`0h0m` refuses (same rationale)', () => {
  const result = parsePersistUntil('0h0m', { nowMs: NOW_MS });
  assert.equal(result.ok, false);
});

test('bare integer `4` (no unit) refuses; the grammar requires a unit', () => {
  const result = parsePersistUntil('4', { nowMs: NOW_MS });
  assert.equal(result.ok, false);
});

test('duration `1m` (a single minute) parses correctly', () => {
  const result = parsePersistUntil('1m', { nowMs: NOW_MS });
  assert.equal(result.ok, true);
  assert.equal(result.source, 'duration');
  assert.equal(result.deadlineMs, NOW_MS + 60 * 1000);
});
