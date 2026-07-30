// Pre-flight interactive session
// (verification-integrity-cluster-spec §4.5, ADDENDUM §A.1).
//
// Walks the scanner's candidates with the operator, then poses any
// applicable design-shape questions. Emits a session record ready for
// the manifest writer. Every path in this module operates through an
// injected prompt/write pair so the CLI handler owns the readline
// wiring and the tests can drive the session without a TTY.
//
// Register (per the 0.5.2 operator-communication register — plain
// prose, no jargon citations, one leading question, tone of "it's in
// hand"): the interactive text below reads as a colleague walking the
// operator through decisions, not as a schema questionnaire.

import { recordPreflightSecret } from './secrets.js';
import { validateDesignShapeAnswer } from './design-shapes.js';

/**
 * @typedef {(question: string) => Promise<string>} PromptFn
 * @typedef {(line: string) => void} WriteFn
 */

const ATTESTATION_CHOICES = [
  { key: '1', mode: 'live', label: 'live — tests hit the live service with a real key you supply' },
  { key: '2', mode: 'sandboxed', label: 'sandboxed — provider sandbox mode with a real key (no delivery)' },
  { key: '3', mode: 'mocked', label: 'mocked — local fixtures or stubs; not ship-authoritative on its own' },
  { key: '4', mode: 'declaredMockOnly', label: 'declaredMockOnly — ship mock-only intentionally (feature-flagged off, stub for local dev, pre-launch)' },
  { key: '5', mode: 'notShipped', label: 'notShipped — for local development only; no production path uses it' },
];

const MODE_BY_KEY = new Map(ATTESTATION_CHOICES.map((c) => [c.key, c.mode]));

/**
 * @param {object} args
 * @param {import('./scanner.js').ServiceCandidate} args.candidate
 * @param {PromptFn} args.prompt
 * @param {WriteFn} args.write
 * @param {string} args.projectRoot
 * @param {NodeJS.ProcessEnv} [args.env]
 * @returns {Promise<import('./manifest-writer.js').PreflightServiceRuling>}
 */
async function walkOneServiceCandidate({ candidate, prompt, write, projectRoot, env }) {
  write(`\nService candidate: ${candidate.displayName}`);
  write(`Suggested id: ${candidate.id} (category ${candidate.category})`);
  const refsSummary = candidate.sourceRefs.slice(0, 5)
    .map((r) => `  - ${r.docId}${r.anchor === '/' ? '' : r.anchor} : "${r.phrase}"`)
    .join('\n');
  if (refsSummary.length > 0) write(`Where the scanner spotted it:\n${refsSummary}`);
  if (candidate.sourceRefs.length > 5) {
    write(`  (+${candidate.sourceRefs.length - 5} more source refs)`);
  }
  write('\nHow will tests verify this integration?');
  for (const c of ATTESTATION_CHOICES) write(`  ${c.key}) ${c.label}`);

  let mode;
  while (mode === undefined) {
    const ans = (await prompt('Select 1-5: ')).trim();
    if (MODE_BY_KEY.has(ans)) mode = MODE_BY_KEY.get(ans);
    else write('Not one of the five options; try again.');
  }

  const sourceRefs = Array.from(new Set(candidate.sourceRefs.map((r) => `${r.docId}${r.anchor === '/' ? '' : r.anchor}`)));

  /** @type {import('./manifest-writer.js').PreflightServiceRuling} */
  const ruling = {
    id: candidate.id,
    displayName: candidate.displayName,
    sourceRefs,
    attestationMode: mode,
    credentialSupplied: false,
    sandboxProvisioned: false,
  };

  if (mode === 'live' || mode === 'sandboxed') {
    const envVarName = (await prompt('Which env var carries the credential (name only): ')).trim();
    if (envVarName.length > 0) {
      // recordPreflightSecret reads the shell env by NAME only; the
      // side-file records presence booleans, never a value.
      const secret = await recordPreflightSecret({ projectRoot, serviceId: candidate.id, envVarName, env });
      ruling.credentialSupplied = secret.envVarPresentAtSessionTime;
      if (mode === 'sandboxed') ruling.sandboxProvisioned = true;
      if (!secret.envVarPresentAtSessionTime) {
        write(`Note: ${envVarName} is not set in this shell; the side-file records that so the harness knows to prompt at run time.`);
      }
    }
  } else if (mode === 'declaredMockOnly' || mode === 'notShipped') {
    const reason = (await prompt('One-line reason (recorded on the chain): ')).trim();
    if (reason.length > 0) ruling.operatorReason = reason;
  } else if (mode === 'mocked') {
    const reason = (await prompt('One-line reason a mock is acceptable here (recorded on the chain): ')).trim();
    if (reason.length > 0) ruling.operatorReason = reason;
  }

  return ruling;
}

/**
 * @param {object} args
 * @param {import('./design-shapes.js').DesignShapeQuestion} args.question
 * @param {string} args.reqId
 * @param {PromptFn} args.prompt
 * @param {WriteFn} args.write
 * @returns {Promise<import('./manifest-writer.js').PreflightDesignShapeAnswer|null>}
 */
async function walkOneDesignShapeQuestion({ question, reqId, prompt, write }) {
  write(`\nDesign-shape question against ${reqId}: ${question.prompt}`);
  for (let i = 0; i < question.choices.length; i += 1) {
    const c = question.choices[i];
    write(`  ${i + 1}) ${c.display}${c.triggersOptOut ? '   (records an opt-out on the baseline ledger)' : ''}`);
  }
  let choice;
  while (choice === undefined) {
    const ans = (await prompt(`Select 1-${question.choices.length}: `)).trim();
    const idx = Number.parseInt(ans, 10);
    if (Number.isFinite(idx) && idx >= 1 && idx <= question.choices.length) {
      choice = question.choices[idx - 1];
    } else {
      write('Not one of the listed options; try again.');
    }
  }
  /** @type {import('./manifest-writer.js').PreflightDesignShapeAnswer} */
  const answer = { questionId: question.id, reqId, answer: choice.value };
  if (choice.triggersOptOut) {
    let reason;
    while (reason === undefined) {
      const r = (await prompt(`Reason (at least ${question.reasonMinLength} chars, recorded on the ledger): `)).trim();
      if (r.length >= question.reasonMinLength) reason = r;
      else write(`That reason is ${r.length} chars; the ledger floor is ${question.reasonMinLength}.`);
    }
    answer.reason = reason;
  }
  return answer;
}

/**
 * Run the interactive session. Returns the composed service rulings and
 * design-shape answers ready for `composePreflightRecord`.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {import('./scanner.js').ScannerResult} args.scan
 * @param {object[]} args.reqsForDesignShapes
 * @param {import('./design-shapes.js').DesignShapeQuestion[]} [args.catalogue]
 * @param {PromptFn} args.prompt
 * @param {WriteFn} args.write
 * @param {NodeJS.ProcessEnv} [args.env]
 * @returns {Promise<{ services: import('./manifest-writer.js').PreflightServiceRuling[], designShapeAnswers: import('./manifest-writer.js').PreflightDesignShapeAnswer[] }>}
 */
export async function runInteractiveSession({
  projectRoot, scan, reqsForDesignShapes, catalogue, prompt, write, env,
}) {
  const services = [];
  for (const candidate of scan.candidates) {
    const ruling = await walkOneServiceCandidate({ candidate, prompt, write, projectRoot, env });
    services.push(ruling);
  }

  // Operator additions (candidates the scanner missed). Prompted after
  // the scanner walk so the operator has seen the whole seed set first.
  while (true) {
    const wantMore = (await prompt('Add a service the scanner missed? (y/N): ')).trim().toLowerCase();
    if (wantMore !== 'y' && wantMore !== 'yes') break;
    const id = (await prompt('Service id (camelCase): ')).trim();
    if (id.length === 0) continue;
    const displayName = (await prompt('Display name: ')).trim() || id;
    const synthetic = {
      id, displayName, category: 'operatorAdded', sourceRefs: [],
    };
    const ruling = await walkOneServiceCandidate({ candidate: synthetic, prompt, write, projectRoot, env });
    services.push(ruling);
  }

  const designShapeAnswers = [];
  const { selectApplicableQuestions } = await import('./design-shapes.js');
  const applicable = selectApplicableQuestions(reqsForDesignShapes, catalogue);
  for (const { question, reqId } of applicable) {
    const answer = await walkOneDesignShapeQuestion({ question, reqId, prompt, write });
    if (answer) {
      const err = validateDesignShapeAnswer({
        questionId: answer.questionId, answer: answer.answer, reason: answer.reason,
      });
      if (err) throw new Error(err);
      designShapeAnswers.push(answer);
    }
  }

  write('\nSession summary:');
  for (const s of services) {
    write(`  ${s.id} (${s.displayName}) -> ${s.attestationMode}${s.credentialSupplied ? ' [cred present]' : ''}`);
  }
  for (const a of designShapeAnswers) {
    write(`  ${a.questionId} on ${a.reqId} -> ${a.answer}`);
  }
  const confirm = (await prompt('\nConfirm this pre-flight record and commit? (yes/no): ')).trim().toLowerCase();
  if (confirm !== 'y' && confirm !== 'yes') {
    throw new Error('preflight: session cancelled by operator');
  }
  return { services, designShapeAnswers };
}

/**
 * Non-interactive path: read a pre-filled input file and validate its
 * shape enough that a downstream manifest write will validate against
 * the schema.
 *
 * @param {object} input
 * @returns {{ services: import('./manifest-writer.js').PreflightServiceRuling[], designShapeAnswers: import('./manifest-writer.js').PreflightDesignShapeAnswer[] }}
 */
export function normaliseNonInteractiveInput(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('preflight: --input file did not parse to an object');
  }
  const rawServices = Array.isArray(input.services) ? input.services : [];
  const services = rawServices.map((s, idx) => {
    if (!s || typeof s !== 'object') throw new Error(`preflight: services[${idx}] must be an object`);
    if (typeof s.id !== 'string' || s.id.length === 0) throw new Error(`preflight: services[${idx}].id required`);
    if (typeof s.attestationMode !== 'string') throw new Error(`preflight: services[${idx}].attestationMode required`);
    return {
      id: s.id,
      displayName: typeof s.displayName === 'string' ? s.displayName : s.id,
      sourceRefs: Array.isArray(s.sourceRefs) ? s.sourceRefs.map(String) : [],
      attestationMode: s.attestationMode,
      credentialSupplied: Boolean(s.credentialSupplied),
      sandboxProvisioned: Boolean(s.sandboxProvisioned),
      operatorReason: typeof s.operatorReason === 'string' ? s.operatorReason : undefined,
      affectedFbsIds: Array.isArray(s.affectedFbsIds) ? s.affectedFbsIds.map(String) : undefined,
    };
  });
  const rawAnswers = Array.isArray(input.designShapeAnswers) ? input.designShapeAnswers : [];
  const designShapeAnswers = rawAnswers.map((a, idx) => {
    if (!a || typeof a !== 'object') throw new Error(`preflight: designShapeAnswers[${idx}] must be an object`);
    if (typeof a.questionId !== 'string') throw new Error(`preflight: designShapeAnswers[${idx}].questionId required`);
    if (typeof a.answer !== 'string') throw new Error(`preflight: designShapeAnswers[${idx}].answer required`);
    const err = validateDesignShapeAnswer({
      questionId: a.questionId, answer: a.answer, reason: a.reason,
    });
    if (err) throw new Error(`preflight: designShapeAnswers[${idx}]: ${err}`);
    return {
      questionId: a.questionId,
      reqId: typeof a.reqId === 'string' ? a.reqId : undefined,
      answer: a.answer,
      reason: typeof a.reason === 'string' ? a.reason : undefined,
    };
  });
  return { services, designShapeAnswers };
}
