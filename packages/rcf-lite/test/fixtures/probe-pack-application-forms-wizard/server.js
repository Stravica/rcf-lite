// Sample-app fixture for the application-forms-wizard probe pack.
//
// Dependency-free Node HTTP server. Realises the wizard contract
// honestly on /task-list, /step/<n>, /summary and /in-progress so
// every pack check can run against a real DOM. Two draft-store
// transports (server-draft-table default and client-local-buffer
// elicited alternative) render honestly on their query branches,
// and break switches drive the negative runs from a single boot:
//
// ?break=task-list-vocab swaps a state string away from the
// closed GOV.UK vocabulary (AC-24101-1
// must fail)
// ?break=no-summary drops the error-summary region on the
// refused step (AC-24103-1 must fail)
// ?break=no-retain drops the answers on the edit-and-save
// round-trip (AC-24104-1 must fail)
// ?break=no-draft drops the draft transport altogether
// (AC-24105-1 must fail)
//
// PORT env picks the bind port (default 3000). Never binds 4200
// (reserved for the operator workspace). Prints LISTENING <port>
// once bound. FORMS_WIZARD_BREAK forces one of the break switches
// across every request; per-request ?break= still wins when both
// are set.
//
// Exports startServer({ port }) so the anatomy test can drive the
// same shell without spawning a child process, and exports
// STEP_STATES, TRANSPORTS, STEP_MANIFEST and BREAK_SWITCHES for
// enumeration.

import http from 'node:http';
import { URL } from 'node:url';
import { randomUUID } from 'node:crypto';

function stampRequestId(req, res) {
 const inbound = req.headers['x-request-id'];
 const id = typeof inbound === 'string' && inbound.length > 0 ? inbound : randomUUID();
 res.setHeader('x-fixture-request-id', id);
 return id;
}

export const STEP_STATES = ['Cannot start yet', 'Not started', 'In progress', 'Completed'];
export const TRANSPORTS = ['server-draft-table', 'client-local-buffer'];
export const STEP_MANIFEST = [
 { slug: 'contact-details', title: 'Contact details', prerequisites: [] },
 { slug: 'shipping-address', title: 'Shipping address', prerequisites: ['contact-details'] },
 { slug: 'payment', title: 'Payment', prerequisites: ['contact-details', 'shipping-address'] },
];
export const BREAK_SWITCHES = ['task-list-vocab', 'no-summary', 'no-retain', 'no-draft'];

// the probe must drive a varied manifest so the
// rendered task-list rows and /__task-manifest are BOTH derived from
// the same varied input rather than the module constant STEP_MANIFEST.
// A per-request `?manifest=slug1|slug2|slug3` query selects a distinct
// ordered manifest, and startServer({ manifestOverride: [...] }) sets
// a process-wide override. The default remains STEP_MANIFEST.
let MODULE_MANIFEST_OVERRIDE = null;
export function setManifestOverride(next) { MODULE_MANIFEST_OVERRIDE = Array.isArray(next) && next.length > 0 ? next.slice() : null; }
function parseQueryManifest(url) {
 const raw = url.searchParams.get('manifest');
 if (!raw) return null;
 const parts = raw.split('|').map((seg) => seg.trim()).filter(Boolean);
 if (parts.length === 0) return null;
 return parts.map((slug) => ({ slug, title: slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), prerequisites: [] }));
}
function resolveManifest(url) {
 return parseQueryManifest(url) || MODULE_MANIFEST_OVERRIDE || STEP_MANIFEST;
}

const DEFAULT_BREAK = process.env.FORMS_WIZARD_BREAK || null;

// In-memory server-side draft table. Keyed by operator id (single
// synthetic operator on the fixture) and wizard slug. Structure:
// { [operatorId]: { [wizardSlug]: { fields: { [stepSlug.fieldSlug]: value }, updatedAt } } }
const drafts = { 'operator-1': {} };

function escapeHtml(s) {
 return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function shellHead(title) {
 return `<title>${escapeHtml(title)}</title>
<style>
 body { font-family: system-ui, sans-serif; margin: 0; padding: 0; color: #111; }
 main { padding: 1.25rem 1.5rem; max-width: 720px; }
 [data-surface] { padding: 1rem; border-radius: 4px; border: 1px solid #d0d7e0; background: #f6f8fb; margin: 1rem 0; }
 [data-surface="task-list"] ol { list-style: none; padding-left: 0; }
 [data-step-slug] { padding: 0.35rem 0; border-top: 1px solid #d0d7e0; display: flex; justify-content: space-between; }
 [data-step-state] { font-weight: 600; }
 [data-surface="error-summary"] { border: 2px solid #b10e1e; background: #fff4f2; }
 [data-recovery="change"] { text-decoration: underline; }
 [aria-invalid="true"] { border: 2px solid #b10e1e; }
 [data-error-message] { color: #b10e1e; font-size: 0.9em; }
 [data-live-region="polite"] { position: absolute; left: -9999px; top: -9999px; }
 [data-sync-tick] { font-family: monospace; font-size: 0.85em; color: #666; }
</style>`;
}

function bodyOpen() {
 return `<main>`;
}

function bodyClose() {
 return `</main>`;
}

function resolveBreak(url) {
 const q = url.searchParams.get('break');
 if (q && BREAK_SWITCHES.includes(q)) return q;
 return DEFAULT_BREAK && BREAK_SWITCHES.includes(DEFAULT_BREAK) ? DEFAULT_BREAK : null;
}

function isoNow() {
 return new Date().toISOString();
}

function seededAnswersForComplete() {
 return {
 'contact-details': { fullName: 'Alex Example', email: 'alex@example.test' },
 'shipping-address': { line1: '1 Test Way', postcode: 'SW1A 1AA' },
 'payment': { cardHolder: 'A Example', last4: '4242' },
 };
}

function computeStepState(step, answers) {
 const unfinishedPrereq = step.prerequisites.find((p) => {
 const stepAnswers = answers[p] || {};
 return !isStepComplete(p, stepAnswers);
 });
 if (unfinishedPrereq) return 'Cannot start yet';
 const own = answers[step.slug] || {};
 const keys = Object.keys(own);
 if (keys.length === 0) return 'Not started';
 return isStepComplete(step.slug, own) ? 'Completed' : 'In progress';
}

function isStepComplete(slug, own) {
 if (slug === 'contact-details') return !!(own.fullName && own.email);
 if (slug === 'shipping-address') return !!(own.line1 && own.postcode);
 if (slug === 'payment') return !!(own.cardHolder && own.last4);
 return false;
}

function renderTaskListPage(url) {
 const brk = resolveBreak(url);
 const nav = url.searchParams.get('nav') === 'free' ? 'free' : 'linear';
 const seed = url.searchParams.get('seed');
 const manifest = resolveManifest(url);
 let answers = {};
 if (seed === 'partial') {
 answers = { 'contact-details': { fullName: 'Alex Example', email: 'alex@example.test' } };
 } else if (seed === 'complete') {
 answers = seededAnswersForComplete();
 }
 // computeStepState reads by slug so any manifest ordering works.
 const rowStates = manifest.map((step) => ({ step, state: computeStepState(step, answers) }));
 if (brk === 'task-list-vocab' && rowStates.length > 0) {
 rowStates[0].state = 'kicked-off';
 }
 const completedCount = rowStates.filter((r) => r.state === 'Completed').length;
 const rowsHtml = rowStates.map(({ step, state }, i) => {
 const isDisabledLinear = nav === 'linear' && state === 'Cannot start yet';
 const rowInner = isDisabledLinear
 ? `<span data-role="step-title">${escapeHtml(step.title)}</span>`
 : `<a href="/step/${i + 1}?nav=${nav}" data-role="step-title">${escapeHtml(step.title)}</a>`;
 return `<li data-step-slug="${escapeHtml(step.slug)}" data-step-state="${escapeHtml(state)}">${rowInner}<span data-step-state-label>${escapeHtml(state)}</span></li>`;
 }).join('\n');
 return `<!doctype html><html lang="en"><head>${shellHead('Wizard task-list')}</head><body>${bodyOpen()}
<h1>Task list</h1>
<section data-surface="task-list">
 <div role="progressbar" aria-valuenow="${completedCount}" aria-valuemax="${manifest.length}" aria-valuetext="${escapeHtml(String(completedCount))} of ${manifest.length} steps completed">${completedCount} of ${manifest.length} steps completed</div>
 <ol>${rowsHtml}</ol>
</section>
<div data-live-region="polite" aria-live="polite"></div>
${bodyClose()}</body></html>`;
}

function renderStepPage(url, stepIndex) {
 const brk = resolveBreak(url);
 const draftStore = url.searchParams.get('draft-store') || 'server';
 const refused = url.searchParams.get('refused') === '1';
 const blurred = url.searchParams.get('blurred') === '1';
 const corrected = url.searchParams.get('corrected') === '1';
 const preseed = url.searchParams.get('preseed') === '1';
 const step = STEP_MANIFEST[stepIndex - 1];
 if (!step) return { status: 404, body: '<h1>Not found</h1>' };
 // Preseed a draft write on request so the pack can inspect the
 // persisted state on the very next request. On the server branch
 //the fixture write into the in-memory drafts table synchronously; on the
 //local branch the fixture emit a client script that writes into
 // localStorage on load.
 if (preseed && draftStore === 'server' && brk !== 'no-draft') {
 drafts['operator-1']['application-forms-wizard'] = drafts['operator-1']['application-forms-wizard'] || { fields: {}, updatedAt: null };
 drafts['operator-1']['application-forms-wizard'].fields[`${step.slug}.fullName`] = 'Alex Example';
 drafts['operator-1']['application-forms-wizard'].updatedAt = isoNow();
 }
 const errorSummary = refused && brk !== 'no-summary'
 ? `<section data-surface="error-summary" aria-labelledby="error-summary-heading"><h2 id="error-summary-heading" tabindex="-1">There is a problem</h2><ul><li><a href="#field-fullName">Full name is required</a></li></ul></section>`
 : '';
 // AC-24102-1 timing state markers:
 // blurred=1 -> field has a message via aria-describedby but no aria-invalid yet
 // refused=1 -> post first-submit failure: aria-invalid true AND aria-describedby AND top-summary
 // corrected=1 -> submit rebuild: no error-summary, no aria-invalid, no message
 const fieldInvalidAttrs = refused
 ? ' aria-invalid="true" aria-describedby="err-fullName"'
 : (blurred ? ' aria-describedby="err-fullName"' : '');
 const fieldErrorMessage = (refused || blurred) && !corrected
 ? `<p data-error-message id="err-fullName">Full name is required</p>`
 : '';
 const validationMarker = refused
 ? '<span data-validation-state="submit-failure" hidden></span>'
 : blurred
 ? '<span data-validation-state="blur" hidden></span>'
 : corrected
 ? '<span data-validation-state="rebuilt" hidden></span>'
 : '<span data-validation-state="pristine" hidden></span>';
 const focusScript = refused
 ? `<script>document.addEventListener('DOMContentLoaded', function(){ var h = document.getElementById('error-summary-heading'); if (h && typeof h.focus === 'function') { h.focus(); } });</script>`
 : '';
 // Draft-store preseed script for the local branch. Namespaced key
 // draft:<wizard-slug>:<step-slug>. Sync tick element updates on
 // every write.
 const localSeedScript = preseed && draftStore === 'local' && brk !== 'no-draft'
 ? `<script>document.addEventListener('DOMContentLoaded', function(){ var key = 'draft:application-forms-wizard:${step.slug}'; window.localStorage.setItem(key, JSON.stringify({fullName:'Alex Example'})); var tick = document.querySelector('[data-sync-tick]'); if (tick) { tick.setAttribute('data-sync-tick', new Date().toISOString()); tick.textContent = 'Saved at ' + new Date().toISOString(); }});</script>`
 : '';
 const noDraftBanner = brk === 'no-draft'
 ? `<p data-draft-store="none">No draft transport wired.</p>`
 : '';
 return { status: 200, body: `<!doctype html><html lang="en"><head>${shellHead(`Step ${stepIndex}`)}</head><body>${bodyOpen()}
<h1>${escapeHtml(step.title)}</h1>
${errorSummary}
<form action="/step/${stepIndex}" method="post" data-step-form="${escapeHtml(step.slug)}">
 <div>
 <label for="field-fullName">Full name</label>
 <input type="text" id="field-fullName" name="fullName"${fieldInvalidAttrs}>
 ${fieldErrorMessage}
 </div>
 <button type="submit">Save and continue</button>
</form>
${validationMarker}
<div data-sync-tick data-sync-tick=""></div>
${noDraftBanner}
<div data-live-region="polite" aria-live="polite"></div>
${focusScript}
${localSeedScript}
${bodyClose()}</body></html>` };
}

function renderSummaryPage(url) {
 const brk = resolveBreak(url);
 const seed = url.searchParams.get('seed');
 const editSlug = url.searchParams.get('edit');
 const editValue = url.searchParams.get('value');
 if (seed !== 'complete') {
 return { status: 200, body: `<!doctype html><html><head>${shellHead('Summary review')}</head><body>${bodyOpen()}<p>Complete every step before the summary review.</p>${bodyClose()}</body></html>` };
 }
 const answers = seededAnswersForComplete();
 //The edit-and-save round-trip. On ?edit=<field-slug>&value=<x> the fixture
 // update the seeded answer for that field; every other row keeps
 // its seeded value verbatim. The no-retain break wipes every
 // unedited answer to prove AC-24104-1 fails when retention breaks.
 if (editSlug && editValue !== null && editValue !== undefined) {
 let applied = false;
 for (const [stepSlug, fields] of Object.entries(answers)) {
 for (const key of Object.keys(fields)) {
 const composite = `${stepSlug}.${key}`;
 if (composite === editSlug) {
 fields[key] = editValue;
 applied = true;
 } else if (brk === 'no-retain') {
 fields[key] = '';
 }
 }
 }
 void applied;
 }
 const sections = Object.entries(answers).map(([stepSlug, fields]) => {
 const rows = Object.entries(fields).map(([fieldKey, value]) => {
 const compositeSlug = `${stepSlug}.${fieldKey}`;
 const changeHref = `/step/${STEP_MANIFEST.findIndex((s) => s.slug === stepSlug) + 1}?field=${encodeURIComponent(fieldKey)}`;
 return `<div data-summary-row data-field-slug="${escapeHtml(compositeSlug)}"><dt>${escapeHtml(fieldKey)}</dt><dd>${escapeHtml(value)}</dd><a data-recovery="change" href="${escapeHtml(changeHref)}">Change</a></div>`;
 }).join('');
 return `<section data-summary-list-section data-step-slug="${escapeHtml(stepSlug)}"><h2>${escapeHtml(stepSlug)}</h2><dl>${rows}</dl></section>`;
 }).join('');
 return { status: 200, body: `<!doctype html><html><head>${shellHead('Summary review')}</head><body>${bodyOpen()}
<h1>Summary review</h1>
<section data-surface="summary-review">
${sections}
</section>
${bodyClose()}</body></html>` };
}

function renderInProgressPage(url) {
 void url;
 const wizards = Object.keys(drafts['operator-1'] || {});
 if (wizards.length === 0) {
 // Delegate the empty case to the application-empty-error-states
 // empty-list surface. Fixture renders the same [data-surface] and
 // [data-recovery="create"] wrapper the sibling blueprint's pack
 // asserts, so a consumer that has applied both blueprints reads
 // the same surface from either blueprint.
 return { status: 200, body: `<!doctype html><html><head>${shellHead('In progress forms')}</head><body>${bodyOpen()}
<h1>In progress</h1>
<section data-surface="empty-list">
 <div data-visual="empty-list">
 <p>You have no in progress forms.</p>
 <a data-recovery="create" href="/step/1">Start a new form</a>
 </div>
</section>
${bodyClose()}</body></html>` };
 }
 const rows = wizards.map((slug) => `<div data-wizard-row><span data-wizard-title>${escapeHtml(slug)}</span><span data-step-slug>contact-details</span><a data-recovery="resume" href="/task-list">Resume</a></div>`).join('');
 return { status: 200, body: `<!doctype html><html><head>${shellHead('In progress forms')}</head><body>${bodyOpen()}
<h1>In progress</h1>
<section data-surface="in-progress-list">
${rows}
</section>
${bodyClose()}</body></html>` };
}

function serializeDraftsForOperator() {
 const state = drafts['operator-1']['application-forms-wizard'];
 if (!state) return { operatorId: 'operator-1', wizardSlug: 'application-forms-wizard', fields: {}, updatedAt: null };
 return {
 operatorId: 'operator-1',
 wizardSlug: 'application-forms-wizard',
 fields: state.fields,
 updatedAt: state.updatedAt,
 };
}

function sendHtml(res, status, body) {
 res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
 res.end(body);
}

function sendJson(res, status, obj) {
 res.writeHead(status, { 'content-type': 'application/json' });
 res.end(JSON.stringify(obj));
}

function handle(req, res) {
 const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
 stampRequestId(req, res);
 const path = url.pathname;
 if (path === '/validate' && req.method === 'POST') {
 // AC-24102-1 rebuild contract: every submit rebuilds the error
 // set from scratch. The endpoint accepts { fullName } and
 // returns the current error set for that step.
 let raw = '';
 req.on('data', (chunk) => { raw += chunk; });
 req.on('end', () => {
 let parsed = {};
 try { parsed = JSON.parse(raw || '{}'); } catch { parsed = {}; }
 const errors = {};
 if (!parsed.fullName || String(parsed.fullName).trim().length === 0) {
 errors.fullName = 'Full name is required';
 }
 const fieldsChecked = ['fullName'];
 sendJson(res, 200, {
 stepSlug: parsed.step || 'contact-details',
 errors,
 errorCount: Object.keys(errors).length,
 fieldsChecked,
 rebuildOf: parsed.previousErrorCount ?? null,
 });
 });
 return;
 }
 if (path === '/' || path === '/task-list') {
 return sendHtml(res, 200, renderTaskListPage(url));
 }
 if (path === '/summary') {
 const { status, body } = renderSummaryPage(url);
 return sendHtml(res, status, body);
 }
 if (path === '/in-progress') {
 const { status, body } = renderInProgressPage(url);
 return sendHtml(res, status, body);
 }
 const stepMatch = path.match(/^\/step\/(\d+)$/);
 if (stepMatch) {
 const idx = Number.parseInt(stepMatch[1], 10);
 if (req.method === 'POST') {
 // Synthetic advance: write into the in-memory drafts.
 const step = STEP_MANIFEST[idx - 1];
 if (step) {
 drafts['operator-1']['application-forms-wizard'] = drafts['operator-1']['application-forms-wizard'] || { fields: {}, updatedAt: null };
 drafts['operator-1']['application-forms-wizard'].fields[`${step.slug}.fullName`] = 'Posted value';
 drafts['operator-1']['application-forms-wizard'].updatedAt = isoNow();
 }
 return sendJson(res, 200, { ok: true });
 }
 const { status, body } = renderStepPage(url, idx);
 return sendHtml(res, status, body);
 }
 if (path === '/drafts' && req.method === 'GET') {
 const operatorId = url.searchParams.get('operatorId') || 'operator-1';
 const wizardSlug = url.searchParams.get('wizardSlug') || 'application-forms-wizard';
 const state = drafts[operatorId] && drafts[operatorId][wizardSlug];
 return sendJson(res, 200, state
 ? { operatorId, wizardSlug, fields: state.fields, updatedAt: state.updatedAt }
 : { operatorId, wizardSlug, fields: {}, updatedAt: null }
 );
 }
 if (path === '/drafts' && req.method === 'POST') {
 // AC-24105-1: request body must carry operatorId and wizardSlug
 // in addition to step/field/value. The fixture reads them from
 // the body rather than hard-coding, so a probe drives real state
 // scoped to the operator+wizard pair.
 let raw = '';
 req.on('data', (chunk) => { raw += chunk; });
 req.on('end', () => {
 try {
 const parsed = JSON.parse(raw || '{}');
 const operatorId = typeof parsed.operatorId === 'string' && parsed.operatorId.length > 0 ? parsed.operatorId : null;
 const wizardSlug = typeof parsed.wizardSlug === 'string' && parsed.wizardSlug.length > 0 ? parsed.wizardSlug : null;
 if (!operatorId || !wizardSlug) {
 sendJson(res, 400, { ok: false, error: 'operatorId and wizardSlug are required on the draft body (AC-24105-1)' });
 return;
 }
 if (parsed.step && parsed.field && parsed.value !== undefined) {
 drafts[operatorId] = drafts[operatorId] || {};
 drafts[operatorId][wizardSlug] = drafts[operatorId][wizardSlug] || { fields: {}, updatedAt: null };
 drafts[operatorId][wizardSlug].fields[`${parsed.step}.${parsed.field}`] = parsed.value;
 drafts[operatorId][wizardSlug].updatedAt = isoNow();
 sendJson(res, 200, { ok: true, operatorId, wizardSlug });
 return;
 }
 sendJson(res, 400, { ok: false, error: 'step/field/value required' });
 } catch {
 sendJson(res, 400, { ok: false, error: 'malformed body' });
 }
 });
 return;
 }
 if (path === '/__task-manifest' && req.method === 'GET') {
 // Derived from resolveManifest(url) - same source the task-list
 // shell rendered its rows from. When the probe varies the input
 // (either `?manifest=slug1|slug2|...` or setManifestOverride()
 // before it drives /task-list), BOTH the shell and this endpoint
 // reflect the varied input, so their agreement is a derived
 // observation, not fixture self-agreement on the module constant.
 const manifest = resolveManifest(url);
 sendJson(res, 200, { steps: manifest.map((s) => ({ slug: s.slug, title: s.title })), allowedStates: ['Not started', 'In progress', 'Cannot start yet', 'Completed'] });
 return;
 }
 return sendHtml(res, 404, `<!doctype html><html><head>${shellHead('Not found')}</head><body>${bodyOpen()}<h1>Not found</h1>${bodyClose()}</body></html>`);
}

export function startServer({ port = 0, manifestOverride } = {}) {
 if (manifestOverride !== undefined) setManifestOverride(manifestOverride);
 return new Promise((resolve, reject) => {
 if (port === 4200) {
 reject(new Error('port 4200 is reserved for the operator workspace; pick another port'));
 return;
 }
 const server = http.createServer(handle);
 server.on('error', reject);
 server.listen(port, '127.0.0.1', () => {
 const bound = server.address().port;
 resolve({ server, port: bound });
 });
 });
}

const isEntry = import.meta.url === `file://${process.argv[1]}`;
if (isEntry) {
 const port = Number.parseInt(process.env.PORT || '3000', 10);
 startServer({ port }).then(({ port: bound }) => {
 // eslint-disable-next-line no-console
 console.log(`LISTENING ${bound}`);
 }).catch((err) => {
 // eslint-disable-next-line no-console
 console.error(err.message);
 process.exit(1);
 });
}
