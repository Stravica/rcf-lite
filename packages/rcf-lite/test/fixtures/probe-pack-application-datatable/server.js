// Sample-app fixture for the application-datatable probe pack.
//
// A dependency-free Node HTTP server that realises every surface the
// blueprint's six pack checks probe: sortable columns with keyboard-
// reachable controls, text-filter that issues a `q` request, server-
// side pagination with an aria-live "Page N of M" region, row
// selection with a bulk action opening a dialog that returns focus,
// four distinct states (empty / loading / error / no-results)
// switchable by query parameter, and a keyboard column-reorder path.
//
// The fixture is intentionally framework-free: everything the pack
// asserts on lives in one shell HTML plus one inline client script.
// A single query parameter (`?state=empty|loading|error|no-results`)
// swaps to the alternative states.
//
// PORT env var picks the port (default 3000). The server prints
// `LISTENING <port>` once bound so a caller can grep for it.

import http from 'node:http';
import { URL } from 'node:url';

const ALL_ROWS = [
  { id: 1, name: 'Alpha', score: 30, region: 'north' },
  { id: 2, name: 'Bravo', score: 10, region: 'south' },
  { id: 3, name: 'Charlie', score: 20, region: 'north' },
  { id: 4, name: 'Delta', score: 40, region: 'east' },
  { id: 5, name: 'Echo', score: 50, region: 'west' },
  { id: 6, name: 'Foxtrot', score: 15, region: 'south' },
  { id: 7, name: 'Golf', score: 35, region: 'east' },
  { id: 8, name: 'Hotel', score: 25, region: 'west' },
];

const DEFAULT_PAGE_SIZE = 3;

function sortRows(rows, sort) {
  if (!sort) return rows.slice();
  const [rawKey, rawDir] = String(sort).split(':');
  const direction = rawDir === 'desc' ? -1 : 1;
  const key = rawKey;
  return rows.slice().sort((a, b) => {
    if (a[key] < b[key]) return -1 * direction;
    if (a[key] > b[key]) return 1 * direction;
    return 0;
  });
}

function filterRows(rows, q) {
  if (!q) return rows;
  const needle = String(q).toLowerCase();
  return rows.filter((r) => String(r.name).toLowerCase().includes(needle));
}

function paginate(rows, page, pageSize) {
  const start = (page - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

function renderShell(state, initialPayload) {
  const boot = `<script id="bootData" type="application/json">${JSON.stringify(initialPayload)}</script>`;
  const clientScript = `
    (function () {
      var boot = JSON.parse(document.getElementById('bootData').textContent);
      var state = { rows: boot.rows, total: boot.total, page: boot.page, pageSize: boot.pageSize, sort: boot.sort, q: boot.q };
      var selected = new Set();
      function statusAnnounce(msg) {
        var live = document.getElementById('paginationLive');
        if (live) live.textContent = msg;
      }
      function renderStatus() {
        var live = document.getElementById('paginationLive');
        if (!live) return;
        var totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
        live.textContent = 'Page ' + state.page + ' of ' + totalPages;
      }
      function fetchRows() {
        var params = new URLSearchParams();
        params.set('page', String(state.page));
        params.set('pageSize', String(state.pageSize));
        if (state.q) params.set('q', state.q);
        if (state.sort) params.set('sort', state.sort);
        return fetch('/api/rows?' + params.toString()).then(function (r) { return r.json(); }).then(function (payload) {
          state.rows = payload.rows;
          state.total = payload.total;
          state.page = payload.page;
          state.pageSize = payload.pageSize;
          state.sort = payload.sort;
          state.q = payload.q;
          renderTable();
          renderStatus();
        });
      }
      function renderTable() {
        var tbody = document.querySelector('table[role="grid"] tbody');
        if (!tbody) return;
        tbody.innerHTML = state.rows.map(function (r) {
          var checked = selected.has(r.id) ? ' checked' : '';
          return '<tr data-id="' + r.id + '">'
            + '<td><label><input type="checkbox" class="rowSelect" data-id="' + r.id + '" aria-label="Select row ' + r.id + '"' + checked + '/></label></td>'
            + '<td>' + r.id + '</td>'
            + '<td>' + r.name + '</td>'
            + '<td>' + r.score + '</td>'
            + '<td>' + r.region + '</td>'
            + '</tr>';
        }).join('');
        var noResults = document.getElementById('noResultsRegion');
        if (noResults) noResults.hidden = state.total !== 0 || Boolean(state.q) === false;
        if (state.total === 0 && state.q) {
          var live = document.getElementById('paginationLive');
          if (live) live.textContent = 'No results for "' + state.q + '"';
        }
      }
      function applySortIndicator() {
        var headers = document.querySelectorAll('th[data-column]');
        headers.forEach(function (th) {
          th.setAttribute('aria-sort', 'none');
        });
        if (!state.sort) return;
        var parts = state.sort.split(':');
        var col = parts[0];
        var dir = parts[1] === 'desc' ? 'descending' : 'ascending';
        var target = document.querySelector('th[data-column="' + col + '"]');
        if (target) target.setAttribute('aria-sort', dir);
      }
      function bindSort() {
        document.querySelectorAll('button.sortControl').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var col = btn.getAttribute('data-column');
            var current = state.sort && state.sort.indexOf(col + ':') === 0 ? state.sort.split(':')[1] : null;
            var next = current === 'asc' ? 'desc' : 'asc';
            state.sort = col + ':' + next;
            state.page = 1;
            fetchRows().then(applySortIndicator);
          });
        });
      }
      function bindFilter() {
        var input = document.getElementById('filterInput');
        if (!input) return;
        input.addEventListener('input', function () {
          state.q = input.value;
          state.page = 1;
          fetchRows();
        });
      }
      function bindPagination() {
        var prev = document.getElementById('pagePrev');
        var next = document.getElementById('pageNext');
        if (prev) prev.addEventListener('click', function () {
          if (state.page > 1) { state.page -= 1; fetchRows(); }
        });
        if (next) next.addEventListener('click', function () {
          var totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
          if (state.page < totalPages) { state.page += 1; fetchRows(); }
        });
      }
      function bindSelection() {
        document.addEventListener('change', function (event) {
          var target = event.target;
          if (!target || target.className !== 'rowSelect') return;
          var id = Number(target.getAttribute('data-id'));
          if (target.checked) selected.add(id); else selected.delete(id);
          var counter = document.getElementById('selectionCount');
          if (counter) counter.textContent = String(selected.size);
        });
        var bulk = document.getElementById('bulkAction');
        if (!bulk) return;
        bulk.addEventListener('click', function () {
          if (selected.size === 0) return;
          var dialog = document.getElementById('bulkDialog');
          var confirm = document.getElementById('bulkConfirm');
          var cancel = document.getElementById('bulkCancel');
          if (!dialog) return;
          // Origin row for focus return on close: the first selected
          // row's checkbox (WCAG 2.4.3, ARIA APG dialog-modal). The
          // bulk action button itself is not row-scoped, so restoring
          // focus there would leave the operator outside the table.
          var firstSelected = null;
          selected.forEach(function (id) {
            if (firstSelected === null) firstSelected = id;
          });
          dialog.dataset.trigger = firstSelected !== null ? String(firstSelected) : '';
          dialog.hidden = false;
          dialog.setAttribute('aria-hidden', 'false');
          if (confirm) confirm.focus();
          function closeDialog() {
            dialog.hidden = true;
            dialog.setAttribute('aria-hidden', 'true');
            var originId = dialog.dataset.trigger;
            var originRow = originId ? document.querySelector('input.rowSelect[data-id="' + originId + '"]') : null;
            if (originRow) originRow.focus(); else bulk.focus();
          }
          if (confirm) confirm.onclick = closeDialog;
          if (cancel) cancel.onclick = closeDialog;
        });
      }
      function bindColumnReorder() {
        document.querySelectorAll('button.columnMove').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var col = btn.getAttribute('data-column');
            var direction = btn.getAttribute('data-direction');
            var table = document.querySelector('table[role="grid"]');
            if (!table) return;
            var thead = table.querySelector('thead tr');
            var tbody = table.querySelector('tbody');
            var headers = Array.from(thead.querySelectorAll('th[data-column]'));
            var index = headers.findIndex(function (th) { return th.getAttribute('data-column') === col; });
            if (index === -1) return;
            var swapWith = direction === 'left' ? index - 1 : index + 1;
            if (swapWith < 0 || swapWith >= headers.length) return;
            function swapCells(row, a, b) {
              var cells = row.querySelectorAll(':scope > *');
              var aCol = cells[a + 1];
              var bCol = cells[b + 1];
              if (!aCol || !bCol) return;
              if (a < b) row.insertBefore(bCol, aCol);
              else row.insertBefore(aCol, bCol);
            }
            swapCells(thead, index, swapWith);
            tbody.querySelectorAll('tr').forEach(function (tr) {
              swapCells(tr, index, swapWith);
            });
            statusAnnounce('Column ' + col + ' moved ' + direction);
          });
        });
      }
      function bindColumnVisibility() {
        document.querySelectorAll('input.columnToggle').forEach(function (input) {
          input.addEventListener('change', function () {
            var col = input.getAttribute('data-column');
            var visible = input.checked;
            document.querySelectorAll('[data-column-body="' + col + '"], th[data-column="' + col + '"]').forEach(function (el) {
              el.hidden = !visible;
            });
          });
        });
      }
      renderTable();
      renderStatus();
      applySortIndicator();
      bindSort();
      bindFilter();
      bindPagination();
      bindSelection();
      bindColumnReorder();
      bindColumnVisibility();
    })();
  `;
  const controls = `
    <section aria-labelledby="filterHeading">
      <h2 id="filterHeading">Filter</h2>
      <label><span>Search names</span><input id="filterInput" type="search" name="q" aria-controls="dataGrid"/></label>
    </section>
    <section aria-labelledby="columnVisHeading">
      <h2 id="columnVisHeading">Columns</h2>
      <label><input type="checkbox" class="columnToggle" data-column="score" checked/> Score</label>
      <label><input type="checkbox" class="columnToggle" data-column="region" checked/> Region</label>
    </section>
  `;
  const gridHtml = state.stateName === 'empty' ? `
      <section role="region" aria-labelledby="emptyStateHeading" aria-live="polite" id="emptyRegion">
        <h2 id="emptyStateHeading">Empty state</h2>
        <p>No rows yet. Add one to get started.</p>
      </section>
    ` : state.stateName === 'loading' ? `
      <section role="region" aria-labelledby="loadingStateHeading" aria-live="polite" id="loadingRegion">
        <h2 id="loadingStateHeading">Loading</h2>
        <p>Fetching rows.</p>
      </section>
    ` : state.stateName === 'error' ? `
      <section role="region" aria-labelledby="errorStateHeading" aria-live="polite" id="errorRegion">
        <h2 id="errorStateHeading">Error</h2>
        <p>Could not load rows. Try again.</p>
      </section>
    ` : `
      <section role="region" aria-labelledby="gridHeading" aria-live="polite" id="gridRegion">
        <h2 id="gridHeading">Data</h2>
        <table id="dataGrid" role="grid" aria-label="Data table">
          <thead>
            <tr>
              <th scope="col">Select</th>
              <th scope="col" data-column="id" aria-sort="none">
                <button type="button" class="sortControl" data-column="id">id</button>
                <button type="button" class="columnMove" data-column="id" data-direction="left" aria-label="Move id left">left</button>
                <button type="button" class="columnMove" data-column="id" data-direction="right" aria-label="Move id right">right</button>
              </th>
              <th scope="col" data-column="name" aria-sort="none">
                <button type="button" class="sortControl" data-column="name">name</button>
                <button type="button" class="columnMove" data-column="name" data-direction="left" aria-label="Move name left">left</button>
                <button type="button" class="columnMove" data-column="name" data-direction="right" aria-label="Move name right">right</button>
              </th>
              <th scope="col" data-column="score" aria-sort="none">
                <button type="button" class="sortControl" data-column="score">score</button>
                <button type="button" class="columnMove" data-column="score" data-direction="left" aria-label="Move score left">left</button>
                <button type="button" class="columnMove" data-column="score" data-direction="right" aria-label="Move score right">right</button>
              </th>
              <th scope="col" data-column="region" aria-sort="none">
                <button type="button" class="sortControl" data-column="region">region</button>
                <button type="button" class="columnMove" data-column="region" data-direction="left" aria-label="Move region left">left</button>
                <button type="button" class="columnMove" data-column="region" data-direction="right" aria-label="Move region right">right</button>
              </th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
        <div id="paginationLive" role="status" aria-live="polite"></div>
        <div id="noResultsRegion" role="region" aria-labelledby="noResultsHeading" aria-live="polite" hidden>
          <h2 id="noResultsHeading">No results</h2>
          <p>No rows match the current filter.</p>
        </div>
        <nav aria-label="Pagination">
          <button type="button" id="pagePrev">Previous</button>
          <button type="button" id="pageNext">Next</button>
        </nav>
        <section aria-labelledby="bulkHeading">
          <h2 id="bulkHeading">Bulk actions</h2>
          <p>Selected: <span id="selectionCount">0</span></p>
          <button type="button" id="bulkAction">Archive selected</button>
        </section>
        <div id="bulkDialog" role="dialog" aria-modal="true" aria-labelledby="bulkDialogTitle" aria-describedby="bulkDialogDesc" hidden>
          <h2 id="bulkDialogTitle">Confirm archive</h2>
          <p id="bulkDialogDesc">Archive the selected rows. This action is reversible.</p>
          <button type="button" id="bulkConfirm">Archive</button>
          <button type="button" id="bulkCancel">Cancel</button>
        </div>
      </section>
    `;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Datatable fixture</title>
</head>
<body>
<header>
  <h1>application-datatable fixture</h1>
</header>
<main>
${controls}
${gridHtml}
</main>
${boot}
<script>${clientScript}</script>
</body>
</html>`;
}

export function startServer({ port } = {}) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/' || url.pathname === '/datatable-shell') {
      const stateName = url.searchParams.get('state') ?? 'populated';
      const q = url.searchParams.get('q') ?? '';
      const sort = url.searchParams.get('sort') ?? '';
      const page = Number(url.searchParams.get('page') ?? '1') || 1;
      const pageSize = Number(url.searchParams.get('pageSize') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
      const filtered = filterRows(ALL_ROWS, q);
      const sorted = sortRows(filtered, sort);
      const pageRows = paginate(sorted, page, pageSize);
      const payload = { rows: pageRows, total: filtered.length, page, pageSize, sort, q };
      const shell = renderShell({ stateName }, payload);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(shell);
      return;
    }
    if (url.pathname === '/api/rows') {
      const q = url.searchParams.get('q') ?? '';
      const sort = url.searchParams.get('sort') ?? '';
      const page = Number(url.searchParams.get('page') ?? '1') || 1;
      const pageSize = Number(url.searchParams.get('pageSize') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
      const filtered = filterRows(ALL_ROWS, q);
      const sorted = sortRows(filtered, sort);
      const pageRows = paginate(sorted, page, pageSize);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ rows: pageRows, total: filtered.length, page, pageSize, sort, q }));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });
  const boundPort = Number(port ?? process.env.PORT ?? 3000) || 0;
  return new Promise((resolve) => {
    server.listen(boundPort, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, port: address.port });
    });
  });
}

const isDirect = import.meta.url === `file://${process.argv[1]}`;
if (isDirect) {
  startServer({ port: process.env.PORT ? Number(process.env.PORT) : 3000 }).then(({ server, port: boundPort }) => {
    process.stdout.write(`LISTENING ${boundPort}\n`);
    const stop = () => server.close(() => process.exit(0));
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
  });
}
