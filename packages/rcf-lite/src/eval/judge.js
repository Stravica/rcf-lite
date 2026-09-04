// LLM-as-judge run path for an EVAL. rcf-eval-node spec 2026-09-04
// section 6: `judge.type: llmJudge` runs by spawning `claude` (or
// `codex`) on PATH under subscription auth, capturing structured JSON
// on stdout, validating against the declared response schema, and
// appending a runRecord[] entry on the EVAL document.
//
// Estate rule (banked): every model call goes through the `claude` or
// `codex` CLI. No API keys, no HTTP fetches into rcf-lite. The verify
// launcher demonstrates the shape today (spawn `claude` by bare name).
//
// This module is invocation-only: the spawn contract, stdout capture,
// schema validation, and runRecord append. Case orchestration
// (walking cases[], rolling up per-case scores, applying critical-must-
// pass) is intentionally minimal at v1 (spec: v1 ships one canonical
// invocation, not a full runner).

import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { rcfError } from '#core/errors';

const RESPONSE_ENVELOPE_HINT = {
  type: 'object',
  required: ['perCriterion'],
  properties: {
    perCriterion: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'score'],
        properties: {
          id: { type: 'string' },
          score: { type: 'number', minimum: 0, maximum: 1 },
          rationale: { type: 'string' },
          criticalPass: { type: 'boolean' },
        },
      },
    },
    aggregateScore: { type: 'number', minimum: 0, maximum: 1 },
  },
};

/**
 * @typedef {object} RunOneCaseArgs
 * @property {object} evalDoc              the EVAL document
 * @property {object} caseDoc              one entry from evalDoc.cases[]
 * @property {string} projectRoot          absolute project root
 * @property {string} [systemPromptText]   the resolved system prompt text
 * @property {object} [responseSchema]     the resolved response schema
 * @property {function} [spawnImpl]        seam for tests
 * @property {number} [timeoutMs]          default 60_000
 */

/**
 * Load the harness system prompt and response schema for an EVAL, from
 * `judge.harness.systemPromptPath` and `judge.harness.responseSchemaPath`
 * (paths relative to the project root). Returns a structured error
 * when either cannot be read or the schema is not valid JSON.
 *
 * @param {object} args
 * @param {object} args.evalDoc
 * @param {string} args.projectRoot
 * @returns {Promise<{ systemPromptText: string|null, responseSchema: object|null } | import('#core/errors').RcfError>}
 */
export async function loadJudgeHarness({ evalDoc, projectRoot }) {
  const harness = evalDoc?.judge?.harness;
  if (!harness) {
    return { systemPromptText: null, responseSchema: RESPONSE_ENVELOPE_HINT };
  }
  let systemPromptText = null;
  if (typeof harness.systemPromptPath === 'string') {
    try {
      systemPromptText = await readFile(`${projectRoot}/${harness.systemPromptPath}`, 'utf8');
    } catch (err) {
      return rcfError({
        kind: 'ioFailure',
        message: `eval judge: could not read systemPromptPath ${harness.systemPromptPath}: ${err.message}`,
        filePath: harness.systemPromptPath,
      });
    }
  }
  let responseSchema = null;
  if (typeof harness.responseSchemaPath === 'string') {
    try {
      const raw = await readFile(`${projectRoot}/${harness.responseSchemaPath}`, 'utf8');
      responseSchema = JSON.parse(raw);
    } catch (err) {
      return rcfError({
        kind: 'parseFailure',
        message: `eval judge: could not read/parse responseSchemaPath ${harness.responseSchemaPath}: ${err.message}`,
        filePath: harness.responseSchemaPath,
      });
    }
  }
  return { systemPromptText, responseSchema: responseSchema ?? RESPONSE_ENVELOPE_HINT };
}

/**
 * Run one case through the LLM judge. Spawns the invoker CLI (`claude`
 * by default; `codex` for consumers on the codex leg) with the system
 * prompt via `-p` and the case payload on stdin. Captures stdout,
 * validates against the response schema, and returns the parsed graded
 * result. Model-hint is passed via `--model` when supplied by the
 * harness; otherwise the CLI's default model resolves.
 *
 * @param {RunOneCaseArgs} args
 * @returns {Promise<{ graded: object, invoker: string, modelHintUsed: string|null, rawStdout: string } | import('#core/errors').RcfError>}
 */
export async function runOneCase(args) {
  const {
    evalDoc, caseDoc,
    systemPromptText = null,
    responseSchema = RESPONSE_ENVELOPE_HINT,
    spawnImpl = spawn,
    timeoutMs = 60_000,
  } = args;
  const harness = evalDoc?.judge?.harness;
  if (!harness) {
    return rcfError({
      kind: 'usage',
      message: 'eval judge: judge.harness is required for llmJudge',
      documentId: evalDoc?.id,
      field: 'judge.harness',
    });
  }
  const invoker = harness.invoker;
  if (invoker !== 'claude' && invoker !== 'codex') {
    return rcfError({
      kind: 'usage',
      message: `eval judge: unsupported invoker '${invoker}' (expected 'claude' or 'codex')`,
      documentId: evalDoc?.id,
      field: 'judge.harness.invoker',
    });
  }

  const payload = {
    caseId: caseDoc?.id ?? null,
    input: caseDoc?.input ?? null,
    ...(caseDoc?.expected !== undefined ? { expected: caseDoc.expected } : {}),
    criteria: (evalDoc.criteria ?? []).map((c) => ({
      id: c.id,
      description: c.description,
      critical: Boolean(c.critical),
    })),
    criteriaIds: caseDoc?.criteriaIds ?? [],
    notes: caseDoc?.notes ?? '',
  };
  const stdinText = JSON.stringify(payload);
  const argv = [];
  if (systemPromptText) argv.push('-p', systemPromptText);
  if (typeof harness.modelHint === 'string' && harness.modelHint.length > 0) {
    argv.push('--model', harness.modelHint);
  }
  argv.push('--output-format', 'json');

  const outcome = await spawnAndCollect(invoker, argv, stdinText, { spawnImpl, timeoutMs });
  if ('kind' in outcome && outcome.kind === 'ioFailure') return outcome;

  let graded;
  try {
    graded = JSON.parse(outcome.stdout.trim());
  } catch (err) {
    return rcfError({
      kind: 'parseFailure',
      message: `eval judge: invoker '${invoker}' stdout did not parse as JSON: ${err.message}`,
      documentId: evalDoc.id,
    });
  }
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(responseSchema);
  if (!validate(graded)) {
    const first = (validate.errors ?? [])[0];
    return rcfError({
      kind: 'validation',
      message: `eval judge: response failed schema at ${first?.instancePath ?? '/'} ${first?.message ?? 'invalid'}`,
      documentId: evalDoc.id,
    });
  }
  return {
    graded,
    invoker,
    modelHintUsed: harness.modelHint ?? null,
    rawStdout: outcome.stdout,
  };
}

/**
 * Roll up per-case graded outputs into a runRecord[] entry. Aggregate
 * score is the mean of perCriterion.score across cases (weighted by
 * criterion.weight when supplied). Critical failures are aggregated
 * from any case's perCriterion entry with criticalPass=false on a
 * criterion declared critical.
 *
 * @param {object} args
 * @param {object} args.evalDoc
 * @param {Array<{ caseId: string, graded: object, modelHintUsed: string|null }>} args.cases
 * @param {string} args.runner
 * @param {Date} [args.now]
 * @returns {object} runRecord entry
 */
export function composeRunRecord({ evalDoc, cases, runner, now = new Date() }) {
  const criteriaById = new Map((evalDoc.criteria ?? []).map((c) => [c.id, c]));
  const perCaseScores = [];
  const criticalFailures = [];
  let totalWeight = 0;
  let weightedSum = 0;
  for (const c of cases) {
    const graded = c.graded ?? {};
    const perCrit = Array.isArray(graded.perCriterion) ? graded.perCriterion : [];
    let caseSum = 0;
    let caseWeight = 0;
    for (const entry of perCrit) {
      const crit = criteriaById.get(entry.id);
      const weight = typeof crit?.weight === 'number' && crit.weight > 0 ? crit.weight : 1;
      const score = typeof entry.score === 'number' ? Math.max(0, Math.min(1, entry.score)) : 0;
      caseWeight += weight;
      caseSum += weight * score;
      if (crit?.critical && entry.criticalPass === false) {
        criticalFailures.push({ caseId: c.caseId, criterionId: entry.id });
      }
    }
    const caseAggregate = caseWeight > 0 ? caseSum / caseWeight : 0;
    perCaseScores.push({ caseId: c.caseId, aggregate: caseAggregate });
    totalWeight += caseWeight;
    weightedSum += caseSum;
  }
  const aggregateScore = totalWeight > 0 ? weightedSum / totalWeight : 0;
  const passThreshold = evalDoc.passThreshold ?? {};
  const criticalMustPass = passThreshold.criticalMustPass !== false;
  const meetsAggregate = aggregateScore >= (typeof passThreshold.aggregateScore === 'number' ? passThreshold.aggregateScore : 0.85);
  const criticalOk = !(criticalMustPass && criticalFailures.length > 0);
  const verdict = meetsAggregate && criticalOk ? 'pass' : 'fail';
  const modelPinned = cases.find((c) => c.modelHintUsed)?.modelHintUsed ?? null;
  const record = {
    runId: `${now.toISOString()}-${Math.random().toString(36).slice(2, 6)}`,
    runAt: now.toISOString(),
    runner,
    aggregateScore,
    criticalFailures,
    perCaseScores,
    verdict,
  };
  if (modelPinned) record.modelPinned = modelPinned;
  return record;
}

/**
 * Append a runRecord[] entry to an EVAL document.
 *
 * @param {object} args
 * @param {object} args.evalDoc
 * @param {object} args.runRecord
 * @returns {object} updated evalDoc (new object; caller writes it)
 */
export function appendRunRecord({ evalDoc, runRecord }) {
  const runs = Array.isArray(evalDoc.runRecord) ? evalDoc.runRecord : [];
  return {
    ...evalDoc,
    runRecord: [...runs, runRecord],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Spawn the invoker and collect stdout / stderr. Returns
 * `{ stdout, stderr, code }` on success, or a rcfError on failure.
 *
 * @param {string} invoker
 * @param {string[]} argv
 * @param {string} stdinText
 * @param {{ spawnImpl?: function, timeoutMs?: number }} opts
 * @returns {Promise<{ stdout: string, stderr: string, code: number|null } | import('#core/errors').RcfError>}
 */
export function spawnAndCollect(invoker, argv, stdinText, { spawnImpl = spawn, timeoutMs = 60_000 } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnImpl(invoker, argv, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      resolve(rcfError({
        kind: 'ioFailure',
        message: `eval judge: failed to spawn '${invoker}': ${err.message}`,
      }));
      return;
    }
    let stdout = '';
    let stderr = '';
    let done = false;
    const timer = setTimeout(() => {
      done = true;
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      resolve(rcfError({
        kind: 'ioFailure',
        message: `eval judge: invoker '${invoker}' timed out after ${timeoutMs}ms`,
      }));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(rcfError({
        kind: 'ioFailure',
        message: `eval judge: invoker '${invoker}' error: ${err.message}`,
      }));
    });
    child.on('close', (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (code !== 0) {
        resolve(rcfError({
          kind: 'ioFailure',
          message: `eval judge: invoker '${invoker}' exited with code ${code}: ${stderr.slice(0, 400)}`,
        }));
        return;
      }
      resolve({ stdout, stderr, code });
    });
    try {
      child.stdin.end(stdinText);
    } catch (err) {
      done = true;
      clearTimeout(timer);
      resolve(rcfError({
        kind: 'ioFailure',
        message: `eval judge: writing stdin to '${invoker}' failed: ${err.message}`,
      }));
    }
  });
}
