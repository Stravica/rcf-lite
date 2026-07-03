// ASCII table formatter for coverage / trace / impact result envelopes.
// Zero-dep, uses Node built-in string padding. Column widths adapt to
// the widest cell per column, capped at a sane per-column maximum so a
// single very long title doesn't force the whole table off-screen.
//
// Phase 5 §D3: default output format. British English column headers,
// ASCII hyphens only (§D19).

const COLUMN_CAP = 60;

/**
 * Format a query result as an ASCII table (or two labelled blocks
 * around a pivot for trace --both). Trailing newline included.
 *
 * @param {object} result
 * @param {'coverage' | 'trace' | 'impact'} verb
 * @returns {string}
 */
export function formatTable(result, verb) {
  if (verb === 'coverage') return formatCoverageTable(result);
  if (verb === 'trace') return formatTraceTable(result);
  if (verb === 'impact') return formatImpactTable(result);
  return '';
}

function formatCoverageTable(result) {
  const lines = [];
  const modeLabel = result.strict ? 'strict (per-AC)' : 'shallow-any';
  lines.push(`Coverage mode: ${modeLabel}`);
  lines.push(
    `Requirements: ${result.totals.requirements}  ` +
      `covered: ${result.totals.covered}  ` +
      `uncovered: ${result.totals.uncovered}`,
  );
  lines.push('');
  const rows = [];
  rows.push(['Requirement', 'Covered', 'AC', 'AC covered', 'Test cases']);
  for (const req of result.requirements) {
    if (req.acs.length === 0) {
      rows.push([req.id, req.covered ? 'yes' : 'no', '(no AC)', '-', '-']);
      continue;
    }
    for (const [i, ac] of req.acs.entries()) {
      rows.push([
        i === 0 ? req.id : '',
        i === 0 ? (req.covered ? 'yes' : 'no') : '',
        ac.id,
        ac.covered ? 'yes' : 'no',
        ac.testCases.length > 0 ? ac.testCases.join(', ') : '-',
      ]);
    }
  }
  lines.push(renderTable(rows));
  return `${lines.join('\n')}\n`;
}

function formatTraceTable(result) {
  if (!result.found) return `trace: id ${result.pivot} not found\n`;
  if (result.direction === 'both') {
    return formatBothTraceTable(result);
  }
  const lines = [];
  const directionLabel = result.direction === 'forward' ? 'Descendants' : 'Ancestors';
  lines.push(`Trace pivot: ${result.pivot}  direction: ${result.direction}`);
  lines.push('');
  const rows = [];
  rows.push(['Depth', 'Id', 'Kind', 'Title']);
  const showList = (result.nodes ?? []).slice();
  if (showList.length <= 1) {
    lines.push(`${directionLabel}: (none)`);
  } else {
    for (const n of showList) {
      rows.push([String(n.depth), n.id, n.kind, cellTitle(n.id)]);
    }
    lines.push(renderTable(rows));
  }
  return `${lines.join('\n')}\n`;
}

function formatBothTraceTable(result) {
  const lines = [];
  lines.push(`Trace pivot: ${result.pivot}  direction: both`);
  lines.push('');
  lines.push('Ancestors:');
  const ancestors = result.ancestors ?? [];
  if (ancestors.length === 0) {
    lines.push('  (none)');
  } else {
    const rows = [['Depth', 'Id', 'Kind', 'Title']];
    for (const n of ancestors) rows.push([String(n.depth), n.id, n.kind, '']);
    lines.push(renderTable(rows));
  }
  lines.push('');
  lines.push(`Pivot: ${result.pivot}`);
  lines.push('');
  lines.push('Descendants:');
  const descendants = result.descendants ?? [];
  if (descendants.length === 0) {
    lines.push('  (none)');
  } else {
    const rows = [['Depth', 'Id', 'Kind', 'Title']];
    for (const n of descendants) rows.push([String(n.depth), n.id, n.kind, '']);
    lines.push(renderTable(rows));
  }
  return `${lines.join('\n')}\n`;
}

function formatImpactTable(result) {
  if (!result.found) return `impact: id ${result.pivot} not found\n`;
  const lines = [];
  lines.push(`Impact pivot: ${result.pivot}`);
  lines.push('');
  const rows = [['Id', 'Kind', 'Role', 'Action needed']];
  for (const n of result.nodes ?? []) {
    rows.push([n.id, n.kind, n.role, n.actionNeeded ?? '-']);
  }
  lines.push(renderTable(rows));
  return `${lines.join('\n')}\n`;
}

// Table renderer. Every cell is stringified, truncated at COLUMN_CAP,
// then padded to the column's widest observed cell. Deterministic
// spacing; no ANSI colours; two spaces between columns.

function renderTable(rows) {
  const widths = new Array(rows[0].length).fill(0);
  const cells = rows.map((r) => r.map((c) => {
    let s = c == null ? '' : String(c);
    if (s.length > COLUMN_CAP) s = `${s.slice(0, COLUMN_CAP - 3)}...`;
    return s;
  }));
  for (const r of cells) {
    for (let i = 0; i < r.length; i += 1) {
      if (r[i].length > widths[i]) widths[i] = r[i].length;
    }
  }
  const out = cells.map(
    (r) => r.map((c, i) => c.padEnd(widths[i])).join('  ').replace(/ +$/, ''),
  );
  // Header separator: `-` under each column.
  const sep = widths.map((w) => '-'.repeat(w)).join('  ').replace(/ +$/, '');
  return [out[0], sep, ...out.slice(1)].join('\n');
}

// Placeholder for future title lookup - the pure trace result does not
// carry doc bodies, so title columns render blank unless the caller
// passes a title source. Left here for the trace `Title` column so the
// column stays if we ever wire in a title map without a schema change.
function cellTitle(_id) {
  return '';
}
