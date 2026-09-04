// Sample-app fixture for the application-dashboard probe pack.
//
// A dependency-free Node HTTP server that renders the dashboard
// surface the blueprint's three pack checks probe: a tile row with
// a primary KPI top-left, a chart region reusing the application-
// charts sample-app markup shape, filter chrome, a timeframe preset
// picker with the refetch fan-out contract, and an export handle
// with the three shipped formats.
//
// Break switches (query parameters on the root route) let the probe
// pack drive the negative runs:
//   ?break=kpi-position   demotes the primary KPI so it is not first
//                         and drops its grid-column-start
//   ?break=fanout         drifts the second refetch's `to` boundary
//                         by one hour so the fan-out batch is inconsistent
//   ?break=state-aria     drops role="region" and aria-live from tiles
//
// State pinning (for the four-state check):
//   ?tile=primary&state=<loading|empty|error|populated>
//
// The pack against the untouched root returns pass on every check;
// the pack against each break switch returns fail on the matching
// check id, severity block, aggregate block.
//
// PORT env var picks the port (default 3000). The server prints
// `LISTENING <port>` once bound so a caller can grep for it.
//
// startServer({ port }) is exported so tests can drive the server
// on ephemeral ports without a subprocess.

import http from 'node:http';
import { URL } from 'node:url';

// Fixed as-of stamp (overridable via ?asof=<iso>) so the pack's
// fan-out check reads a stable value regardless of the wall clock.
const DEFAULT_AS_OF = '2026-09-04T22:00:00Z';

const PRESET_LIST = ['last-7-days', 'last-30-days', 'quarter-to-date'];

function presetBoundary(preset, brk, index) {
  const to = new Date('2026-09-04T22:00:00Z');
  const from = new Date(to);
  if (preset === 'last-7-days') from.setUTCDate(to.getUTCDate() - 7);
  else if (preset === 'last-30-days') from.setUTCDate(to.getUTCDate() - 30);
  else if (preset === 'quarter-to-date') from.setUTCDate(to.getUTCDate() - 65);
  else from.setUTCDate(to.getUTCDate() - 7);
  // ?break=fanout: drift the boundary on every second fetch in a batch
  const driftedTo = brk === 'fanout' && index % 2 === 1
    ? new Date(to.getTime() + 60 * 60 * 1000)
    : to;
  return { from: from.toISOString(), to: driftedTo.toISOString() };
}

const requestLog = [];

function recordRequest(entry) {
  requestLog.push({ ...entry, at: new Date().toISOString() });
}

function renderTile({ tileId, title, kind, role, state, brk, kpiName }) {
  const tileState = state || 'populated';
  const ariaLive = brk === 'state-aria' ? '' : ' aria-live="polite"';
  const wrapperRole = brk === 'state-aria' ? '' : ' role="region"';
  const roleAttr = role ? ` data-tile-role="${role}"` : '';
  const kindAttr = kind ? ` data-kpi-kind="${kind}"` : '';
  const kpiNameAttr = kpiName ? ` data-kpi-name="${kpiName}"` : '';
  const columnStart = role === 'primary-kpi' && brk !== 'kpi-position' ? 'grid-column-start:1;grid-row-start:1;' : '';
  let cueLabel = '';
  let cueBody = '';
  if (tileState === 'loading') {
    cueLabel = 'loading';
    cueBody = '<span class="tileSkeleton" aria-hidden="true"></span><span class="visuallyHidden">Loading data</span>';
  } else if (tileState === 'empty') {
    cueLabel = 'empty';
    cueBody = '<span class="tileEmptyBlock">No data for this period</span>';
  } else if (tileState === 'error') {
    cueLabel = 'error';
    cueBody = '<span class="tileErrorBlock">Fetch failed: upstream timeout</span>';
  } else {
    cueLabel = 'populated';
    const value = role === 'primary-kpi' ? '£182,450' : '124';
    cueBody = `<span class="tileValue">${value}</span><span class="tileUnit">${role === 'primary-kpi' ? 'this period' : 'total'}</span>`;
  }
  const asOf = DEFAULT_AS_OF;
  return `<article class="tile"${roleAttr}${kindAttr}${kpiNameAttr} data-tile-id="${tileId}" data-tile-state="${tileState}" data-as-of="${asOf}" style="${columnStart}"><div${wrapperRole}${ariaLive} data-tile-state="${tileState}" aria-label="${title}, ${cueLabel}"><h3 class="tileTitle">${title}</h3><span data-state-cue="${tileState}">${cueBody}</span></div></article>`;
}

function renderTileRow({ brk, pinned }) {
  const primaryFirst = brk !== 'kpi-position';
  const primaryTile = renderTile({
    tileId: 'primary',
    title: 'Recurring revenue',
    kind: 'revenue',
    role: 'primary-kpi',
    state: pinned?.tileId === 'primary' ? pinned.state : 'populated',
    brk,
  });
  const supportingTiles = [
    renderTile({ tileId: 'active-users', title: 'Active users', kind: null, role: null, state: 'populated', brk }),
    renderTile({ tileId: 'error-rate', title: 'Error rate', kind: null, role: null, state: 'populated', brk }),
    renderTile({ tileId: 'throughput', title: 'Throughput', kind: null, role: null, state: 'populated', brk }),
  ].join('');
  const tiles = primaryFirst
    ? primaryTile + supportingTiles
    : supportingTiles + primaryTile;
  return `<section role="region" aria-label="Tile row" data-region="tile-row" class="tileRow">${tiles}</section>`;
}

function renderChartRegion() {
  // Reuse the application-charts sample-app markup shape at a
  // reduced surface (one two-series line chart) so the dashboard's
  // chart region carries the shell contract without duplicating it.
  const chartHtml = `<section class="chartRegion" role="region" aria-label="Latency chart"><h2>Response latency</h2><svg class="chartSvg" data-chart-form="line" width="240" height="80" role="img" aria-label="Response latency, weekdays"><g class="chartSeriesLine" data-series="p50" data-pattern="solid"><polyline points="20,60 60,55 100,58 140,52 180,50" fill="none" stroke="#1f3b73" stroke-width="2" /></g><g class="chartSeriesLine" data-series="p95" data-pattern="dashed"><polyline points="20,30 60,20 100,25 140,18 180,15" fill="none" stroke="#8a4a00" stroke-width="2" stroke-dasharray="6 4" /></g><text class="chartSeriesLabel" data-series-label="p50" x="185" y="52" font-size="10" fill="#1f3b73">p50</text><text class="chartSeriesLabel" data-series-label="p95" x="185" y="18" font-size="10" fill="#8a4a00">p95</text></svg><table class="chartAltTable"><thead><tr><th scope="col">Day</th><th scope="col">p50</th><th scope="col">p95</th></tr></thead><tbody><tr><th scope="row">Mon</th><td>120</td><td>280</td></tr><tr><th scope="row">Tue</th><td>130</td><td>305</td></tr></tbody></table></section>`;
  return `<section role="region" aria-label="Chart region" data-region="chart-region" class="chartRegionOuter">${chartHtml}</section>`;
}

function renderFilterChrome() {
  return `<section role="region" aria-label="Filter chrome" data-region="filter-chrome" class="filterChrome"><button type="button" class="filterChip" data-filter="account">All accounts</button><button type="button" class="filterChip" data-filter="region">All regions</button></section>`;
}

function renderTimeframePicker(currentPreset) {
  const buttons = PRESET_LIST.map((preset) => {
    const isCurrent = preset === currentPreset;
    return `<button type="button" class="presetButton" data-preset="${preset}"${isCurrent ? ' aria-pressed="true"' : ''}>${preset}</button>`;
  }).join('');
  return `<section role="region" aria-label="Timeframe picker" data-region="timeframe-picker" class="timeframePicker">${buttons}</section>`;
}

function renderExportHandle() {
  return `<section role="region" aria-label="Export handle" data-region="export-handle" class="exportHandle"><button type="button" class="exportButton" aria-haspopup="listbox">Export</button><ul role="listbox" class="exportFormatList" hidden><li role="option" data-export-format="csv">CSV</li><li role="option" data-export-format="pdf">PDF</li><li role="option" data-export-format="png-chart">PNG of chart</li></ul></section>`;
}

function renderShellHtml({ brk, pinnedTile, pinnedState, asOfOverride }) {
  const asOf = asOfOverride || DEFAULT_AS_OF;
  const initialPreset = 'last-7-days';
  const pinned = pinnedTile ? { tileId: pinnedTile, state: pinnedState } : null;
  const shellAttrs = `data-region="shell-root" data-as-of="${asOf}" data-current-preset="${initialPreset}" data-auto-refresh="off"`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>application-dashboard fixture</title>
<style>
  body { font-family: system-ui, sans-serif; padding: 16px; color: #111; background: #fff; margin: 0; }
  .shellHeading { font-size: 18px; margin: 0 0 12px; }
  .shellRoot { display: grid; gap: 16px; }
  .tileRow { display: grid; gap: 12px; grid-template-columns: repeat(4, minmax(120px, 1fr)); grid-template-rows: auto; }
  @media (max-width: 480px) {
    .tileRow { grid-template-columns: 1fr; }
  }
  .tile { border: 1px solid #ccc; padding: 12px; border-radius: 4px; background: #fff; min-height: 96px; }
  .tileTitle { font-size: 13px; margin: 0 0 6px; color: #444; font-weight: 600; }
  .tileValue { display: block; font-size: 22px; font-weight: 600; color: #111; }
  .tileUnit { display: block; font-size: 11px; color: #666; margin-top: 4px; }
  .tileSkeleton { display: block; width: 100%; height: 24px; background: repeating-linear-gradient(45deg,#eee,#eee 6px,#dcdcdc 6px,#dcdcdc 12px); border-radius: 4px; }
  .tileEmptyBlock { display: block; font-size: 12px; color: #555; padding: 6px 8px; border: 1px dashed #bbb; border-radius: 4px; }
  .tileErrorBlock { display: block; font-size: 12px; color: #7a1a1a; padding: 6px 8px; border: 1px solid #7a1a1a; border-radius: 4px; background: #fff5f5; }
  .visuallyHidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .chartRegionOuter { border: 1px solid #ccc; padding: 12px; border-radius: 4px; }
  .filterChrome { display: flex; gap: 8px; }
  .filterChip { border: 1px solid #1f3b73; background: #fff; color: #1f3b73; padding: 4px 10px; border-radius: 999px; cursor: pointer; }
  .timeframePicker { display: flex; gap: 8px; }
  .presetButton { border: 1px solid #1f3b73; background: #fff; color: #1f3b73; padding: 4px 10px; border-radius: 4px; cursor: pointer; }
  .presetButton[aria-pressed="true"] { background: #1f3b73; color: #fff; }
  .exportHandle { display: flex; gap: 8px; align-items: center; }
  .exportButton { border: 1px solid #1f3b73; background: #fff; color: #1f3b73; padding: 4px 10px; border-radius: 4px; cursor: pointer; }
  .exportFormatList { list-style: none; padding: 4px 0; margin: 0; border: 1px solid #1f3b73; border-radius: 4px; background: #fff; }
  .exportFormatList li { padding: 4px 10px; cursor: pointer; }
</style>
</head>
<body>
<main class="shellRoot" ${shellAttrs}>
  <h1 class="shellHeading">application-dashboard fixture</h1>
  ${renderFilterChrome()}
  ${renderTimeframePicker(initialPreset)}
  ${renderExportHandle()}
  ${renderTileRow({ brk, pinned })}
  ${renderChartRegion()}
</main>
<script>
  (function () {
    window.__dashboardFetches = [];
    var root = document.querySelector('[data-region="shell-root"]');
    var tileRow = document.querySelector('[data-region="tile-row"]');
    var brk = ${JSON.stringify(brk || null)};
    function isoBoundary(preset, index) {
      var to = new Date('2026-09-04T22:00:00Z');
      var from = new Date(to.getTime());
      if (preset === 'last-7-days') from.setUTCDate(to.getUTCDate() - 7);
      else if (preset === 'last-30-days') from.setUTCDate(to.getUTCDate() - 30);
      else if (preset === 'quarter-to-date') from.setUTCDate(to.getUTCDate() - 65);
      var driftedTo = (brk === 'fanout' && index % 2 === 1) ? new Date(to.getTime() + 60 * 60 * 1000) : to;
      return { from: from.toISOString(), to: driftedTo.toISOString() };
    }
    function fanOut(preset) {
      var tiles = Array.from(document.querySelectorAll('[data-tile-id]'));
      var chartRegion = document.querySelector('[data-region="chart-region"]');
      var asOf = new Date().toISOString();
      var index = 0;
      tiles.forEach(function (tile) {
        var boundary = isoBoundary(preset, index++);
        var record = { from: boundary.from, to: boundary.to, preset: preset, filters: [], tileId: tile.getAttribute('data-tile-id'), chartId: null, at: new Date().toISOString() };
        window.__dashboardFetches.push(record);
        fetch('/__record?type=tile&tileId=' + record.tileId + '&preset=' + preset + '&from=' + record.from + '&to=' + record.to).catch(function () {});
        tile.setAttribute('data-as-of', asOf);
      });
      if (chartRegion) {
        var boundary = isoBoundary(preset, index++);
        var record = { from: boundary.from, to: boundary.to, preset: preset, filters: [], tileId: null, chartId: 'latency', at: new Date().toISOString() };
        window.__dashboardFetches.push(record);
        fetch('/__record?type=chart&chartId=latency&preset=' + preset + '&from=' + record.from + '&to=' + record.to).catch(function () {});
      }
      root.setAttribute('data-as-of', asOf);
      root.setAttribute('data-current-preset', preset);
      Array.from(document.querySelectorAll('.presetButton')).forEach(function (btn) {
        var isCurrent = btn.getAttribute('data-preset') === preset;
        if (isCurrent) btn.setAttribute('aria-pressed', 'true'); else btn.removeAttribute('aria-pressed');
      });
    }
    Array.from(document.querySelectorAll('.presetButton')).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var preset = btn.getAttribute('data-preset');
        fanOut(preset);
      });
    });
    // Fire the initial fan-out so window.__dashboardFetches has an
    // initial batch the pack can trim against.
    setTimeout(function () { fanOut('last-7-days'); }, 0);
    // Export handle open/close.
    var exportBtn = document.querySelector('.exportButton');
    var exportList = document.querySelector('.exportFormatList');
    if (exportBtn && exportList) {
      exportBtn.addEventListener('click', function () {
        if (exportList.hasAttribute('hidden')) {
          exportList.removeAttribute('hidden');
        } else {
          exportList.setAttribute('hidden', '');
        }
      });
      document.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape') {
          exportList.setAttribute('hidden', '');
          exportBtn.focus();
        }
      });
    }
  })();
</script>
</body>
</html>
`;
}

function respondHtml(res, html) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

function respondJson(res, body, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function respondNotFound(res) {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('not found');
}

function normaliseBreak(v) {
  if (v === 'kpi-position' || v === 'fanout' || v === 'state-aria') return v;
  return null;
}

function normaliseTileState(v) {
  if (v === 'loading' || v === 'empty' || v === 'error' || v === 'populated') return v;
  return null;
}

function handler(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method !== 'GET') {
    res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('method not allowed');
    return;
  }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    const brk = normaliseBreak(url.searchParams.get('break'));
    const pinnedTile = url.searchParams.get('tile');
    const pinnedState = normaliseTileState(url.searchParams.get('state'));
    const asOfOverride = url.searchParams.get('asof');
    respondHtml(res, renderShellHtml({ brk, pinnedTile, pinnedState, asOfOverride }));
    return;
  }
  if (url.pathname === '/__requests') {
    respondJson(res, requestLog);
    return;
  }
  if (url.pathname === '/__record') {
    const kind = url.searchParams.get('type');
    const record = {
      kind,
      tileId: url.searchParams.get('tileId'),
      chartId: url.searchParams.get('chartId'),
      preset: url.searchParams.get('preset'),
      from: url.searchParams.get('from'),
      to: url.searchParams.get('to'),
    };
    recordRequest(record);
    respondJson(res, { ok: true });
    return;
  }
  if (url.pathname === '/api/tile' || url.pathname === '/api/chart') {
    const preset = url.searchParams.get('preset') || 'last-7-days';
    const brk = normaliseBreak(url.searchParams.get('break'));
    const boundary = presetBoundary(preset, brk, requestLog.length);
    respondJson(res, { preset, ...boundary, value: 100 });
    return;
  }
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('ok');
    return;
  }
  respondNotFound(res);
}

export function startServer({ port } = {}) {
  const desiredPort = typeof port === 'number' ? port : Number(process.env.PORT ?? 3000);
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.once('error', reject);
    server.listen(desiredPort, '127.0.0.1', () => {
      const address = server.address();
      const boundPort = typeof address === 'object' && address ? address.port : desiredPort;
      resolve({ server, port: boundPort });
    });
  });
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const desiredPort = Number(process.env.PORT ?? 3000);
  startServer({ port: desiredPort }).then(({ port }) => {
    process.stdout.write(`LISTENING ${port}\n`);
  }).catch((err) => {
    process.stderr.write(`fixture failed to start: ${err.message}\n`);
    process.exit(1);
  });
}
