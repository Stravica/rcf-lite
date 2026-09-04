// Sample-app fixture for the application-charts probe pack.
//
// A dependency-free Node HTTP server that renders the chart surfaces
// the blueprint's three pack checks probe: a two-series bar chart and
// a two-series line chart, series distinguished by colour AND a
// non-colour pattern attribute AND a direct label at the series, a
// visually-hidden focus-reachable text-alternative `<table>` element
// in the same landmark as each chart carrying the same values
// cell-per-value, keyboard-focusable data points announcing
// `<seriesName>, <xValue>, <yValue> <unit>` on focus, and a
// `prefers-reduced-motion: reduce` media rule that removes chart
// transitions.
//
// Break switches (query parameters on the root route) let the probe
// pack drive the negative runs:
//   ?break=table    drops the `<table>` element from every chart landmark
//   ?break=pattern  drops the data-pattern attribute from every series
//   ?break=keyboard drops the tabindex on every data point and the
//                   aria-label on every focusable data-point element
//
// The pack against the untouched root returns pass on every check;
// the pack against each break switch returns fail on the matching
// check id, severity block, aggregate block.
//
// PORT env var picks the port (default 3000). The server prints
// `LISTENING <port>` once bound so a caller can grep for it.
//
// startServer({ port }) is exported so tests can drive the server on
// ephemeral ports without a subprocess.

import http from 'node:http';
import { URL } from 'node:url';

// Two-series data sets. Colour cue + pattern cue + direct label cue
// per series; the pack asserts every series carries a data-pattern
// attribute and a labelled text node adjacent to the series glyph.
const BAR_DATA = {
  form: 'bar',
  unit: 'requests',
  xAxis: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  series: [
    { name: 'Prod', colour: '#1f3b73', pattern: 'solid', dasharray: null, values: [30, 45, 28, 60, 52] },
    { name: 'Staging', colour: '#8a4a00', pattern: 'hatched', dasharray: null, values: [12, 18, 22, 15, 20] },
  ],
};

const LINE_DATA = {
  form: 'line',
  unit: 'ms',
  xAxis: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  series: [
    { name: 'p50', colour: '#1f3b73', pattern: 'solid', dasharray: null, values: [120, 130, 118, 125, 132] },
    { name: 'p95', colour: '#8a4a00', pattern: 'dashed', dasharray: '6 4', values: [280, 305, 260, 295, 310] },
  ],
};

const CHART_WIDTH = 320;
const CHART_HEIGHT = 180;
const CHART_PAD_LEFT = 40;
const CHART_PAD_RIGHT = 24;
const CHART_PAD_TOP = 12;
const CHART_PAD_BOTTOM = 28;

function normaliseBreak(breakFlag) {
  if (breakFlag === 'table' || breakFlag === 'pattern' || breakFlag === 'keyboard') {
    return breakFlag;
  }
  return null;
}

function computeScale(dataset) {
  const allValues = dataset.series.flatMap((s) => s.values);
  const maxValue = Math.max(...allValues, 1);
  const stepX = (CHART_WIDTH - CHART_PAD_LEFT - CHART_PAD_RIGHT) / Math.max(1, dataset.xAxis.length - (dataset.form === 'bar' ? 0 : 1));
  const scaleY = (CHART_HEIGHT - CHART_PAD_TOP - CHART_PAD_BOTTOM) / maxValue;
  return { maxValue, stepX, scaleY };
}

function renderBarChart(dataset, { break: brk }) {
  const { stepX, scaleY } = computeScale(dataset);
  const seriesCount = dataset.series.length;
  const groupWidth = stepX;
  const barWidth = Math.max(6, Math.floor((groupWidth - 8) / seriesCount));
  const groups = dataset.xAxis.map((xLabel, xi) => {
    const groupX = CHART_PAD_LEFT + xi * groupWidth + 4;
    const bars = dataset.series.map((series, si) => {
      const value = series.values[xi];
      const barHeight = value * scaleY;
      const x = groupX + si * barWidth;
      const y = CHART_HEIGHT - CHART_PAD_BOTTOM - barHeight;
      const patternRef = series.pattern === 'hatched' ? ` fill="url(#hatchPattern)"` : ` fill="${series.colour}"`;
      const patternAttr = brk === 'pattern' ? '' : ` data-pattern="${series.pattern}"`;
      const dpFocusAttr = brk === 'keyboard' ? '' : ` tabindex="0" aria-label="${series.name}, ${xLabel}, ${value} ${dataset.unit}"`;
      return `<rect class="chartDataPoint" data-series="${series.name}" data-x="${xLabel}" data-y="${value}"${patternAttr}${dpFocusAttr} x="${x}" y="${y}" width="${barWidth - 2}" height="${barHeight}" stroke="${series.colour}" stroke-width="1"${patternRef} />`;
    }).join('');
    const labelY = CHART_HEIGHT - CHART_PAD_BOTTOM + 14;
    return `<g class="chartGroup">${bars}<text class="chartAxisLabel" x="${groupX + groupWidth / 2 - 4}" y="${labelY}" text-anchor="middle" font-size="10" fill="#333">${xLabel}</text></g>`;
  }).join('');
  const seriesLabels = dataset.series.map((series, si) => {
    const lastValue = series.values[series.values.length - 1];
    const lastX = CHART_PAD_LEFT + (dataset.xAxis.length - 1) * stepX + si * barWidth + barWidth + 6;
    const y = CHART_HEIGHT - CHART_PAD_BOTTOM - lastValue * scaleY - 2;
    return `<text class="chartSeriesLabel" data-series-label="${series.name}" x="${lastX}" y="${y}" font-size="10" fill="${series.colour}">${series.name}</text>`;
  }).join('');
  const defs = `<defs><pattern id="hatchPattern" patternUnits="userSpaceOnUse" width="4" height="4"><path d="M0,4 L4,0" stroke="#8a4a00" stroke-width="1" /></pattern></defs>`;
  return `<svg class="chartSvg" data-chart-form="bar" width="${CHART_WIDTH}" height="${CHART_HEIGHT}" role="img" aria-label="Requests by environment, weekdays">${defs}${groups}${seriesLabels}</svg>`;
}

function renderLineChart(dataset, { break: brk }) {
  const { stepX, scaleY } = computeScale(dataset);
  const lines = dataset.series.map((series) => {
    const points = series.values.map((value, xi) => {
      const x = CHART_PAD_LEFT + xi * stepX;
      const y = CHART_HEIGHT - CHART_PAD_BOTTOM - value * scaleY;
      return `${x},${y}`;
    }).join(' ');
    const dashAttr = series.dasharray ? ` stroke-dasharray="${series.dasharray}"` : '';
    const patternAttr = brk === 'pattern' ? '' : ` data-pattern="${series.pattern}"`;
    const markers = series.values.map((value, xi) => {
      const x = CHART_PAD_LEFT + xi * stepX;
      const y = CHART_HEIGHT - CHART_PAD_BOTTOM - value * scaleY;
      const dpFocusAttr = brk === 'keyboard' ? '' : ` tabindex="0" aria-label="${series.name}, ${dataset.xAxis[xi]}, ${value} ${dataset.unit}"`;
      return `<circle class="chartDataPoint" data-series="${series.name}" data-x="${dataset.xAxis[xi]}" data-y="${value}"${dpFocusAttr} cx="${x}" cy="${y}" r="4" fill="${series.colour}" />`;
    }).join('');
    return `<g class="chartSeriesLine" data-series="${series.name}"${patternAttr}><polyline points="${points}" fill="none" stroke="${series.colour}" stroke-width="2"${dashAttr} />${markers}</g>`;
  }).join('');
  const axisLabels = dataset.xAxis.map((xLabel, xi) => {
    const x = CHART_PAD_LEFT + xi * stepX;
    const y = CHART_HEIGHT - CHART_PAD_BOTTOM + 14;
    return `<text class="chartAxisLabel" x="${x}" y="${y}" text-anchor="middle" font-size="10" fill="#333">${xLabel}</text>`;
  }).join('');
  const seriesLabels = dataset.series.map((series) => {
    const lastValue = series.values[series.values.length - 1];
    const lastX = CHART_PAD_LEFT + (dataset.xAxis.length - 1) * stepX + 6;
    const y = CHART_HEIGHT - CHART_PAD_BOTTOM - lastValue * scaleY + 4;
    return `<text class="chartSeriesLabel" data-series-label="${series.name}" x="${lastX}" y="${y}" font-size="10" fill="${series.colour}">${series.name}</text>`;
  }).join('');
  return `<svg class="chartSvg" data-chart-form="line" width="${CHART_WIDTH}" height="${CHART_HEIGHT}" role="img" aria-label="Response latency, weekdays">${lines}${axisLabels}${seriesLabels}</svg>`;
}

function renderAltTable(dataset, { break: brk }) {
  if (brk === 'table') return '';
  const headerCells = ['<th scope="col">Day</th>']
    .concat(dataset.series.map((s) => `<th scope="col">${s.name} (${dataset.unit})</th>`))
    .join('');
  const rows = dataset.xAxis.map((xLabel, xi) => {
    const cells = [`<th scope="row">${xLabel}</th>`]
      .concat(dataset.series.map((s) => `<td>${s.values[xi]}</td>`))
      .join('');
    return `<tr>${cells}</tr>`;
  }).join('');
  return `<table class="chartAltTable" data-chart-form="${dataset.form}"><caption>${dataset.form === 'bar' ? 'Requests by environment, weekdays' : 'Response latency, weekdays'}</caption><thead><tr>${headerCells}</tr></thead><tbody>${rows}</tbody></table>`;
}

function renderChartRegion(dataset, opts) {
  const chartSvg = dataset.form === 'bar' ? renderBarChart(dataset, opts) : renderLineChart(dataset, opts);
  const altTable = renderAltTable(dataset, opts);
  const showTableButton = altTable === '' ? '' : `<button type="button" class="chartShowAltTable" data-chart-form="${dataset.form}" aria-controls="altTable_${dataset.form}">Show data table</button>`;
  const wrappedTable = altTable === '' ? '' : `<div id="altTable_${dataset.form}" class="chartAltTableWrapper" tabindex="-1">${altTable}</div>`;
  return `<section class="chartRegion" role="region" aria-label="${dataset.form} chart"><h2>${dataset.form === 'bar' ? 'Requests by environment' : 'Response latency'}</h2>${showTableButton}${chartSvg}${wrappedTable}</section>`;
}

function renderShellHtml(opts) {
  const barSection = renderChartRegion(BAR_DATA, opts);
  const lineSection = renderChartRegion(LINE_DATA, opts);
  const clientScript = `
    (function () {
      var buttons = document.querySelectorAll('.chartShowAltTable');
      buttons.forEach(function (btn) {
        btn.addEventListener('click', function () {
          var form = btn.getAttribute('data-chart-form');
          var wrapper = document.getElementById('altTable_' + form);
          if (wrapper) {
            wrapper.focus();
          }
        });
      });
    })();
  `;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>application-charts fixture</title>
<style>
  body { font-family: system-ui, sans-serif; padding: 16px; color: #111; background: #fff; }
  h1 { font-size: 18px; margin: 0 0 12px; }
  .chartRegion { margin-bottom: 24px; padding: 12px; border: 1px solid #ccc; border-radius: 4px; }
  .chartRegion h2 { font-size: 14px; margin: 0 0 8px; }
  .chartSvg { display: block; margin: 8px 0; }
  .chartSeriesLine { transition: opacity 300ms ease-in; }
  .chartDataPoint { transition: transform 200ms ease-out; }
  .chartAltTable { border-collapse: collapse; font-size: 12px; margin-top: 8px; }
  .chartAltTable th, .chartAltTable td { border: 1px solid #999; padding: 3px 8px; text-align: left; }
  .chartAltTableWrapper { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .chartAltTableWrapper:focus { position: static; width: auto; height: auto; overflow: visible; clip: auto; white-space: normal; outline: 2px solid #1f3b73; padding: 4px; }
  .chartShowAltTable { font-size: 12px; padding: 3px 8px; border: 1px solid #1f3b73; background: #fff; color: #1f3b73; cursor: pointer; }
  .chartDataPoint:focus { outline: 2px solid #1f3b73; outline-offset: 2px; }
  @media (prefers-reduced-motion: reduce) {
    .chartSeriesLine, .chartDataPoint { transition: none !important; animation: none !important; transition-duration: 0s !important; animation-duration: 0s !important; }
  }
</style>
</head>
<body>
<main>
  <h1>application-charts fixture</h1>
  ${barSection}
  ${lineSection}
</main>
<script>${clientScript}</script>
</body>
</html>
`;
}

function respondHtml(res, html) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

function respondNotFound(res) {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('not found');
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
    respondHtml(res, renderShellHtml({ break: brk }));
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
