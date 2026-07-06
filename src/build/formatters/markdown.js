// Markdown emitter for the build verb (Phase 6 §D4). Two shapes: the
// seven-section spec-bundle document (§D3) and the queue-overview
// table. Zero-dep string assembly, byte-stable given the same result
// (§D10): no wall clock, no randomness, fixed ordering throughout.
// British English, ASCII hyphens only (§D17).
//
// The bundle's consumer is an implementing agent-harness reading a
// spec: headings and tables carry the structure without a parser, and
// the same artefact is human-reviewable as-is (OQ-P6-5).

const SECTION_NUMBERS = {
  header: 1,
  queueContext: 2,
  work: 3,
  acceptanceCriteria: 4,
  architecturalContext: 5,
  testSurface: 6,
  runbook: 7,
};

/**
 * Format a build result as markdown.
 *
 * @param {object} result - QueueResult | BundleResult | next-mode empty envelope
 * @param {('queue'|'bundle'|'next')} mode
 * @returns {string}
 */
export function formatMarkdown(result, mode) {
  if (mode === 'queue') return formatQueueTable(result);
  if (mode === 'next' && !result.fbs) return formatNextEmpty(result);
  return formatBundle(result);
}

/**
 * Queue overview as a markdown table.
 *
 * @param {object} queue - QueueResult
 * @returns {string}
 */
function formatQueueTable(queue) {
  const lines = [];
  const heading = queue.bs
    ? `# Build queue: ${queue.bs.bsId} - ${queue.bs.title}`
    : '# Build queue';
  lines.push(heading, '');
  if (queue.bs?.generationStrategy) {
    lines.push(`Generation strategy: ${queue.bs.generationStrategy}`, '');
  }
  lines.push('| order | id | title | status | state | blocked by |');
  lines.push('|---|---|---|---|---|---|');
  for (const item of queue.items) {
    const state = item.cycle ? 'blocked (cycle)' : item.state;
    const blockedBy = item.blockedBy.join(', ');
    lines.push(
      `| ${item.buildOrder} | ${item.fbsId} | ${item.title} | ${item.executionStatus} | ${state} | ${blockedBy} |`,
    );
  }
  const t = queue.totals;
  lines.push('');
  lines.push(
    `Totals: items ${t.items} | notStarted ${t.notStarted} | inProgress ${t.inProgress} `
      + `| complete ${t.complete} | verified ${t.verified} | actionable ${t.actionable} `
      + `| blocked ${t.blocked}`,
  );
  lines.push('');
  lines.push(`Next actionable: ${queue.nextActionable ?? 'none'}`);
  return `${lines.join('\n')}\n`;
}

/**
 * `--next` with nothing actionable (§D2 / OQ-P6-2): an explicit
 * envelope distinguishing "done" from "stuck", not an error.
 *
 * @param {object} envelope
 * @returns {string}
 */
function formatNextEmpty(envelope) {
  const lines = ['# Build queue: nothing actionable', ''];
  if (envelope.queueEmpty) {
    lines.push('Queue complete: every item is complete or verified.');
  } else {
    const blocked = envelope.blocked.length > 0 ? envelope.blocked.join(', ') : 'none';
    const inProgress = envelope.inProgress.length > 0 ? envelope.inProgress.join(', ') : 'none';
    lines.push(
      'Queue not complete but nothing is actionable.',
      '',
      `- Blocked: ${blocked}`,
      `- In progress: ${inProgress}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

/**
 * The seven-section spec bundle (§D3). Section numbering is fixed;
 * section 5 is omitted entirely when the FBS carries no
 * contextRequirements (§D11) without renumbering the rest.
 *
 * @param {object} bundle - BundleResult
 * @returns {string}
 */
function formatBundle(bundle) {
  const lines = [];
  const { fbs } = bundle;
  lines.push(`# Spec bundle: ${fbs.fbsId} - ${fbs.title}`, '');
  pushHeader(lines, bundle);
  pushQueueContext(lines, bundle);
  pushWork(lines, bundle);
  pushAcceptanceCriteria(lines, bundle);
  if (bundle.context) pushArchitecturalContext(lines, bundle);
  pushTestSurface(lines, bundle);
  pushRunbook(lines, bundle);
  return `${lines.join('\n')}\n`;
}

function pushHeader(lines, bundle) {
  const { fbs, queue, bs, prd } = bundle;
  lines.push(`## ${SECTION_NUMBERS.header}. Header`, '');
  lines.push(`- Item: ${fbs.fbsId} - ${fbs.title}`);
  lines.push(`- Queue: order ${fbs.buildOrder}, item ${queue.position} of ${queue.total}`);
  lines.push(`- Execution status: ${fbs.executionStatus}`);
  if (fbs.estimatedSize !== undefined) lines.push(`- Estimated size: ${fbs.estimatedSize}`);
  if (fbs.estimatedHours !== undefined) lines.push(`- Estimated hours: ${fbs.estimatedHours}`);
  if (fbs.riskLevel !== undefined) lines.push(`- Risk level: ${fbs.riskLevel}`);
  if (fbs.domain !== undefined) lines.push(`- Domain: ${fbs.domain}`);
  const chain = [];
  if (bs) chain.push(bs.bsId);
  if (prd) chain.push(prd.productName ? `${prd.prdId} (${prd.productName})` : prd.prdId);
  if (chain.length > 0) lines.push(`- Parent chain: ${chain.join(' -> ')}`);
  if (fbs.updatedAt !== undefined) lines.push(`- Spec last touched: ${fbs.updatedAt}`);
  lines.push('');
}

function pushQueueContext(lines, bundle) {
  const { bs, blockedBy, dependencies, dependents } = bundle;
  lines.push(`## ${SECTION_NUMBERS.queueContext}. Queue and dependency context`, '');
  if (blockedBy.length > 0) {
    const blocking = dependencies
      .filter((d) => blockedBy.includes(d.fbsId))
      .map((d) => `${d.fbsId} (${d.executionStatus ?? 'unknown'})`)
      .join(', ');
    lines.push(`> **BLOCKED**: unsatisfied dependencies - ${blocking}.`);
    lines.push('> This bundle is a read-ahead. Do not start implementation until every');
    lines.push('> dependency is complete or verified; `--strict` refuses this bundle.');
    lines.push('');
  }
  if (bs) {
    lines.push(`- Build sequence: ${bs.bsId} - ${bs.title}`);
    if (bs.generationStrategy !== undefined) lines.push(`- Generation strategy: ${bs.generationStrategy}`);
    if (bs.buildPhilosophy !== undefined) lines.push(`- Build philosophy: ${bs.buildPhilosophy}`);
    lines.push('');
  }
  if (dependencies.length > 0) {
    lines.push('Dependencies:', '');
    lines.push('| id | title | status |');
    lines.push('|---|---|---|');
    for (const dep of dependencies) {
      lines.push(`| ${dep.fbsId} | ${dep.title ?? ''} | ${dep.executionStatus ?? ''} |`);
    }
    lines.push('');
  } else {
    lines.push('Dependencies: none.', '');
  }
  lines.push(
    dependents.length > 0
      ? `Dependents waiting on this item: ${dependents.join(', ')}`
      : 'Dependents waiting on this item: none.',
  );
  lines.push('');
}

function pushWork(lines, bundle) {
  const { fbs } = bundle;
  lines.push(`## ${SECTION_NUMBERS.work}. The work`, '');
  lines.push(fbs.summary, '');
  if (fbs.approach !== undefined) {
    lines.push('Approach:', '', fbs.approach, '');
  }
  if (fbs.deliverables !== undefined && fbs.deliverables.length > 0) {
    lines.push('Deliverables:', '');
    for (const d of fbs.deliverables) lines.push(`- ${d}`);
    lines.push('');
  }
  if (fbs.notes !== undefined) {
    lines.push('Notes:', '', fbs.notes, '');
  }
}

function pushAcceptanceCriteria(lines, bundle) {
  lines.push(`## ${SECTION_NUMBERS.acceptanceCriteria}. Acceptance criteria`, '');
  for (const us of bundle.userStories) {
    lines.push(`### ${us.usId}: ${us.title}${us.status !== undefined ? ` (status: ${us.status})` : ''}`, '');
    if (us.asA !== undefined && us.iWant !== undefined && us.soThat !== undefined) {
      lines.push(`As a ${us.asA}, I want ${us.iWant}, so that ${us.soThat}.`, '');
    }
    const acs = bundle.acceptanceCriteria.filter((ac) => ac.usId === us.usId);
    const req = bundle.requirements.find((r) => r.reqId === acs[0]?.reqId);
    if (req) {
      const meta = [req.category, req.priority !== undefined ? `priority: ${req.priority}` : null]
        .filter((v) => v !== null && v !== undefined)
        .join(', ');
      lines.push(`Parent requirement ${req.reqId}: ${req.title}${meta ? ` (${meta})` : ''}`, '');
      if (req.description !== undefined) lines.push(`> ${req.description}`);
      if (req.rationale !== undefined) {
        if (req.description !== undefined) lines.push('>');
        lines.push(`> Rationale: ${req.rationale}`);
      }
      if (req.description !== undefined || req.rationale !== undefined) lines.push('');
    }
    for (const ac of acs) {
      lines.push(`#### ${ac.id}: ${ac.description}`, '');
      if (ac.given !== undefined) lines.push(`- Given: ${ac.given}`);
      if (ac.when !== undefined) lines.push(`- When: ${ac.when}`);
      if (ac.then !== undefined) lines.push(`- Then: ${ac.then}`);
      lines.push(`- Testable: ${ac.testable ? 'yes' : 'no'}`);
      lines.push('');
    }
  }
}

/**
 * Render a resolved TAD / PRD section value. String content renders as
 * prose; structured content (the TAD's sections are objects / arrays)
 * renders as a fenced JSON block - still byte-stable, still readable.
 */
function pushSectionValue(lines, value) {
  if (typeof value === 'string') {
    lines.push(value, '');
  } else {
    lines.push('```json');
    lines.push(JSON.stringify(value, null, 2));
    lines.push('```', '');
  }
}

function pushArchitecturalContext(lines, bundle) {
  const ctx = bundle.context;
  lines.push(`## ${SECTION_NUMBERS.architecturalContext}. Architectural context`, '');
  for (const tac of ctx.tacs) {
    lines.push(`### TAC ${tac.tacId}: ${tac.name}`, '');
    if (tac.purpose !== undefined) lines.push(`Purpose: ${tac.purpose}`, '');
    if (tac.responsibilities !== undefined && tac.responsibilities.length > 0) {
      lines.push('Responsibilities:', '');
      for (const r of tac.responsibilities) lines.push(`- ${r}`);
      lines.push('');
    }
    if (tac.interfaces !== undefined && tac.interfaces.length > 0) {
      lines.push('Interfaces:', '');
      for (const i of tac.interfaces) {
        const kind = i.kind !== undefined ? ` (${i.kind})` : '';
        const desc = i.description !== undefined ? `: ${i.description}` : '';
        lines.push(`- ${i.name}${kind}${desc}`);
      }
      lines.push('');
    }
    if (tac.dependencies !== undefined && tac.dependencies.length > 0) {
      lines.push('Dependencies:', '');
      for (const d of tac.dependencies) {
        const ref = d.kind === 'tac' && d.tacId !== undefined ? `${d.kind} ${d.tacId}` : d.kind;
        const desc = d.description !== undefined ? `: ${d.description}` : '';
        lines.push(`- ${d.name} (${ref})${desc}`);
      }
      lines.push('');
    }
    if (tac.tradeoffs !== undefined) lines.push(`Tradeoffs: ${tac.tradeoffs}`, '');
    if (tac.notes !== undefined) lines.push(`Notes: ${tac.notes}`, '');
  }
  for (const adr of ctx.adrs) {
    lines.push(`### ADR ${adr.adrId}: ${adr.title}${adr.status !== undefined ? ` (${adr.status})` : ''}`, '');
    if (adr.context !== undefined) lines.push(`Context: ${adr.context}`, '');
    if (adr.decision !== undefined) lines.push(`Decision: ${adr.decision}`, '');
    if (adr.consequences !== undefined) lines.push(`Consequences: ${adr.consequences}`, '');
    if (adr.alternativesConsidered !== undefined && adr.alternativesConsidered.length > 0) {
      lines.push('Alternatives considered:', '');
      for (const alt of adr.alternativesConsidered) {
        const summary = alt.summary !== undefined ? `: ${alt.summary}` : '';
        const reason = alt.reasonNotChosen !== undefined ? ` (not chosen: ${alt.reasonNotChosen})` : '';
        lines.push(`- ${alt.name}${summary}${reason}`);
      }
      lines.push('');
    }
  }
  for (const [name, value] of Object.entries(ctx.tadSections)) {
    lines.push(`### TAD section: ${name}`, '');
    pushSectionValue(lines, value);
  }
  for (const [name, value] of Object.entries(ctx.prdSections)) {
    lines.push(`### PRD section: ${name}`, '');
    pushSectionValue(lines, value);
  }
  if (ctx.unresolvedSections.length > 0) {
    lines.push(
      `Warning - unresolved sections (names that did not match a top-level TAD / PRD property): ${ctx.unresolvedSections.join(', ')}`,
      '',
    );
  }
  const pt = ctx.passThrough;
  const ptRows = [
    ['Existing modules', pt.existingModules],
    ['Schemas', pt.schemas],
    ['External docs', pt.externalDocs],
    ['Other', pt.other],
  ].filter(([, list]) => list.length > 0);
  if (ptRows.length > 0) {
    lines.push('Referenced material (pass-through, verbatim):', '');
    for (const [label, list] of ptRows) {
      lines.push(`- ${label}: ${list.join(', ')}`);
    }
    lines.push('');
  }
}

function pushTestSurface(lines, bundle) {
  lines.push(`## ${SECTION_NUMBERS.testSurface}. Existing test surface`, '');
  lines.push('Presence reporting off the tree, not a coverage verdict (`rcf coverage` is the coverage surface).', '');
  for (const entry of bundle.tests) {
    if (!entry.covered && entry.suites.length === 0) {
      lines.push(`- ${entry.acId}: no existing tests - test suite to be written for this AC`);
      continue;
    }
    const suites = entry.suites.length > 0 ? entry.suites.join(', ') : 'none';
    lines.push(`- ${entry.acId}: suites: ${suites}`);
    for (const c of entry.cases) {
      const pointer = c.testPointer !== undefined ? ` [${c.testPointer}]` : '';
      const status = c.status !== undefined ? ` (${c.status})` : '';
      lines.push(`  - ${c.tcId}${status}: ${c.description ?? ''}${pointer}`);
    }
  }
  lines.push('');
}

/**
 * Section 7 - the full RCF five-stage build-cycle runbook (§D3.7,
 * amendment D3-A). Static text parameterised only by fbsId and the
 * in-scope AC ids; the each-stage-commits discipline is part of the
 * printed contract. The tool assembles and referees; the harness
 * executes the cycle.
 */
function pushRunbook(lines, bundle) {
  const fbsId = bundle.fbs.fbsId;
  const acIds = bundle.acceptanceCriteria.map((ac) => ac.id).join(', ');
  lines.push(`## ${SECTION_NUMBERS.runbook}. Build-cycle runbook`, '');
  lines.push('This bundle is the work order for one pass of the RCF five-stage build');
  lines.push('cycle: Define -> Build -> Review -> Test -> Finalise. The tool assembles');
  lines.push('and referees; the harness executes. Every stage ends in a commit.', '');
  // Deep-layer pointer (Phase 7.5 §D5.4, OQ-P7.5-3): the runbook is the
  // terse just-in-time layer; the playbook is the deep layer.
  lines.push('Deep guidance: rcf://docs/build-cycle and the rcf_execute_build_cycle prompt, or guidance/build-cycle-playbook.md in the rcf-build-lite repo.', '');

  lines.push('### Stage 1 - Define', '');
  lines.push('Satisfied by this bundle: the FBS, acceptance criteria, ancestry and');
  lines.push('architectural context above ARE the definition. Confirm your plan against');
  lines.push(`every in-scope acceptance criterion (${acIds}) in section 4 before writing`);
  lines.push('code, then mark pickup:', '');
  lines.push(`    rcf build ${fbsId} --mark inProgress`, '');
  lines.push('Commit any plan artefacts the driving workflow requires.', '');

  lines.push('### Stage 2 - Build', '');
  lines.push('Implement to the acceptance criteria in section 4 using the architectural');
  lines.push('context in section 5. The bundle is the spec: deviation is escalation to');
  lines.push('the operator of the loop, not improvisation. Commit at stage end.', '');

  lines.push('### Stage 3 - Review', '');
  lines.push('Mechanical referee pass:', '');
  lines.push('    rcf validate', '');
  lines.push('must come back clean; then re-read the diff against every in-scope');
  lines.push('acceptance criterion and document any deviations. Commit.', '');

  lines.push('### Stage 4 - Test', '');
  lines.push('Exercise every in-scope acceptance criterion: write or extend the TS / TC');
  lines.push('documents (section 6 lists the existing surface and the flagged gaps) and');
  lines.push('the tests they point to, until:', '');
  lines.push('    rcf coverage --strict', '');
  lines.push('covers the in-scope acceptance criteria. Commit.', '');

  lines.push('### Stage 5 - Finalise', '');
  lines.push('CI green; PR raised and merged per the driving workflow\'s convention.');
  lines.push('After the merge:', '');
  lines.push(`    rcf build ${fbsId} --mark complete`, '');
  lines.push('After post-merge verification:', '');
  lines.push(`    rcf build ${fbsId} --mark verified`);
}
