// 0.30.0 PR 8 (US-17802; REQ-178 / TAC-4126 / AC-17802-1..4).
//
// The four new findings:
//   - interface kind outside INTERFACE_KINDS (defineValidate:interfaceKind)
//   - bracketed AC class prefix outside the five known classes
//     (defineValidate:acClassPrefix)
//   - tacIds naming a non-TAC (defineValidate:tacIdsResolves)
//   - ownerRef or deliveredBy that does not resolve
//     (defineValidate:ownerRefResolves, defineValidate:deliveredByResolves)
//
// Absence of a class marker is NOT a finding (decision 10, kept).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { collectDefineValidateFindings } from '../../src/define/validate-findings.js';

function makeTree({ tacs = [], userStories = [], requirements = [] } = {}) {
  const byId = new Map();
  for (const tac of tacs) byId.set(tac.tacId, tac);
  for (const us of userStories) byId.set(us.usId, us);
  for (const req of requirements) byId.set(req.reqId, req);
  return { tacs, userStories, requirements, byId };
}

test('validate findings (PR 8, AC-17802-1): interface kind outside the vocabulary is a finding', () => {
  const tree = makeTree({
    tacs: [{
      tacId: 'TAC-9001',
      interfaces: [
        { name: 'doThing', kind: 'widget', description: 'bad kind' },
        { name: 'okRoute', kind: 'httpRoute', description: 'ok' },
      ],
    }],
  });
  const findings = collectDefineValidateFindings(tree);
  const kindFindings = findings.filter((f) => f.rule === 'defineValidate:interfaceKind');
  assert.equal(kindFindings.length, 1);
  assert.equal(kindFindings[0].documentId, 'TAC-9001');
  assert.ok(kindFindings[0].message.includes('"widget"'));
  assert.ok(kindFindings[0].message.includes('TAC-9001:doThing'));
});

test('validate findings (PR 8, AC-17802-2): bracketed AC prefix outside the known classes is a finding', () => {
  const tree = makeTree({
    userStories: [{
      usId: 'US-9001',
      acceptanceCriteria: [
        { id: 'AC-9001-1', description: '[sometimes] given X when Y then Z' },
        { id: 'AC-9001-2', description: '[happy] fine prefix' },
      ],
    }],
  });
  const findings = collectDefineValidateFindings(tree);
  const prefix = findings.filter((f) => f.rule === 'defineValidate:acClassPrefix');
  assert.equal(prefix.length, 1);
  assert.equal(prefix[0].documentId, 'AC-9001-1');
  assert.ok(prefix[0].message.includes('[sometimes]'));
});

test('validate findings (PR 8, AC-17802-4): absence of class marker is NOT a finding', () => {
  const tree = makeTree({
    userStories: [{
      usId: 'US-9002',
      acceptanceCriteria: [
        { id: 'AC-9002-1', description: 'given a cold tree, when readiness runs, then the compute still prints.' },
      ],
    }],
  });
  const findings = collectDefineValidateFindings(tree);
  const prefix = findings.filter((f) => f.rule === 'defineValidate:acClassPrefix');
  assert.deepEqual(prefix, [], 'absence of a bracketed prefix must not raise a finding (decision 10)');
});

test('validate findings (PR 8): tacIds, ownerRef and deliveredBy each produce a finding', () => {
  const tree = makeTree({
    tacs: [{
      tacId: 'TAC-9100',
      interfaces: [{ name: 'loan', kind: 'recordShape', description: 'fields: id, amount' }],
    }],
    userStories: [{
      usId: 'US-9100',
      tacIds: ['TAC-9100', 'TAC-DOES-NOT-EXIST'],
      acceptanceCriteria: [
        {
          id: 'AC-9100-1',
          description: '[happy] bad ownerRef',
          ownerRef: { tacId: 'TAC-9100', field: 'interfaces[loan]' },
        },
        {
          id: 'AC-9100-2',
          description: '[happy] ownerRef on unknown TAC',
          ownerRef: { tacId: 'TAC-UNKNOWN', field: 'interfaces[loan]' },
        },
        {
          id: 'AC-9100-3',
          description: '[happy] ownerRef on known TAC but dangling interface',
          ownerRef: { tacId: 'TAC-9100', field: 'interfaces[missing]' },
        },
      ],
    }],
    requirements: [{
      reqId: 'REQ-9100',
      deliveredBy: 'TAC-9999-NOT-REAL',
    }],
  });
  const findings = collectDefineValidateFindings(tree);
  const byRule = findings.reduce((m, f) => {
    (m[f.rule] ??= []).push(f);
    return m;
  }, {});
  assert.ok(byRule['defineValidate:tacIdsResolves']);
  assert.equal(byRule['defineValidate:tacIdsResolves'].length, 1);
  assert.ok(byRule['defineValidate:tacIdsResolves'][0].message.includes('TAC-DOES-NOT-EXIST'));

  assert.ok(byRule['defineValidate:ownerRefResolves']);
  assert.equal(byRule['defineValidate:ownerRefResolves'].length, 2);
  const ownerRefIds = byRule['defineValidate:ownerRefResolves'].map((f) => f.documentId).sort();
  assert.deepEqual(ownerRefIds, ['AC-9100-2', 'AC-9100-3']);

  assert.ok(byRule['defineValidate:deliveredByResolves']);
  assert.equal(byRule['defineValidate:deliveredByResolves'].length, 1);
  assert.equal(byRule['defineValidate:deliveredByResolves'][0].documentId, 'REQ-9100');
});
