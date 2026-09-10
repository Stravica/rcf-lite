// Probe: manifest schema validate.
//
// anchorAcId: AC-37102-1 (also covers AC-37106-1 firewall shape and
// AC-37107-1 snapshot cadence enum via the same schema). accountBound: false.
//
// Validates every hetzner/servers/*.json under the shared throwaway-server
// fixture against blueprints/deploy-hetzner-server/contributions/schemas/
// hetzner-server.schema.json. A lightweight in-process draft-07 subset
// validator ships with the probe so the shelf gains no runtime dependency
// on ajv or similar. See validate() at the bottom.
//
// Purity: the probe reads only the manifest dir and the shipped schema;
// no process.env.SIMULATE_ switch is read here. The fixture-side shim
// packages/rcf-lite/test/fixtures/hetzner-throwaway-server/
// run-manifest-schema-validate.mjs is the sole reader of
// SIMULATE_MANIFEST_INVALID and it mutates INPUT (a temp manifest dir
// pointed at via RCF_FIXTURE_MANIFEST_DIR) only; the probe then FAILS
// naming the offending field per hetzner-round-7-spec-2026-09-07.md
// section 3.4 lesson 4.  (2026-09-08).

import { readFile } from 'node:fs/promises';
import { readManifestFiles, SCHEMA_PATH } from './probe-utils.mjs';

export const anchorAcId = 'AC-37102-1';
export const accountBound = false;

export default async function runProbe() {
  const schema = JSON.parse(await readFile(SCHEMA_PATH, 'utf8'));
  const { present, files } = await readManifestFiles();
  if (!present) {
    return {
      results: [{
        anchorAcId,
        verdict: 'fail',
        detail: 'fixture hetzner/servers/ holds zero JSON files; ship at least ci-throwaway.json.',
      }],
    };
  }
  const results = [];
  for (const f of files) {
    let doc;
    try {
      doc = JSON.parse(f.text);
    } catch (err) {
      results.push({
        anchorAcId,
        verdict: 'fail',
        detail: `manifest ${f.name} does not parse: ${err.message}`,
      });
      continue;
    }
    const errors = validate(schema, doc, `#/${f.name}`);
    if (errors.length > 0) {
      for (const e of errors) {
        const anchor = anchorForError(e);
        results.push({
          anchorAcId: anchor,
          verdict: 'fail',
          detail: `manifest ${f.name} schema violation at ${e.path}: ${e.message}`,
        });
      }
    } else {
      results.push({
        anchorAcId,
        verdict: 'pass',
        detail: `manifest ${f.name} validates against hetzner-server.schema.json (nine required fields, firewall rule shape, snapshotCadence enum all satisfied).`,
      });
    }
  }
  return {
    results,
    extra: {
      manifestCount: files.length,
      manifestNames: files.map((f) => f.name),
    },
  };
}

function anchorForError(err) {
  if (err.field === 'firewallRules' || (err.path || '').includes('firewallRules')) {
    return 'AC-37106-1';
  }
  if (err.field === 'snapshotCadence' || (err.path || '').includes('snapshotCadence')) {
    return 'AC-37107-1';
  }
  return 'AC-37102-1';
}

// Draft-07 subset validator: required, type, enum, minLength, minItems,
// additionalProperties, items, properties, required-on-array-items.
// Extra rule: on firewallRules the ssh rule sourceIps must NOT include
// 0.0.0.0/0 (per TAC-3804); handled after schema validation.
export function validate(schema, doc, pathPrefix = '#') {
  const errors = [];
  walk(schema, doc, pathPrefix, errors);
  if (Array.isArray(doc.firewallRules)) {
    const ssh = doc.firewallRules.find((r) => r && r.name === 'ssh');
    if (ssh && Array.isArray(ssh.sourceIps) && ssh.sourceIps.some((s) => s === '0.0.0.0/0' || s === '::/0')) {
      errors.push({
        path: `${pathPrefix}/firewallRules/ssh/sourceIps`,
        field: 'firewallRules',
        message: 'ssh rule sourceIps must not include 0.0.0.0/0 or ::/0; use an operator-nominated set per TAC-3804.',
      });
    }
    const need = ['ssh', 'http', 'https'];
    for (const n of need) {
      if (!doc.firewallRules.some((r) => r && r.name === n)) {
        errors.push({
          path: `${pathPrefix}/firewallRules`,
          field: 'firewallRules',
          message: `firewallRules is missing the required ${n} rule per TAC-3804.`,
        });
      }
    }
  }
  return errors;
}

function walk(schema, value, path, errors) {
  if (!schema || typeof schema !== 'object') return;
  if (Array.isArray(schema.required) && typeof value === 'object' && value !== null && !Array.isArray(value)) {
    for (const k of schema.required) {
      if (!(k in value)) {
        errors.push({ path: `${path}/${k}`, field: k, message: `missing required field ${k}` });
      }
    }
  }
  if (schema.type) {
    const typeOk = checkType(schema.type, value);
    if (!typeOk) {
      errors.push({ path, message: `expected type ${JSON.stringify(schema.type)}, got ${jsType(value)}` });
      return;
    }
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push({ path, message: `value ${JSON.stringify(value)} is not in enum ${JSON.stringify(schema.enum)}` });
  }
  if (typeof schema.minLength === 'number' && typeof value === 'string' && value.length < schema.minLength) {
    errors.push({ path, message: `string shorter than minLength ${schema.minLength}` });
  }
  if (typeof schema.minItems === 'number' && Array.isArray(value) && value.length < schema.minItems) {
    errors.push({ path, message: `array shorter than minItems ${schema.minItems}` });
  }
  if (schema.type === 'object' && schema.additionalProperties === false && value && typeof value === 'object') {
    const known = new Set(Object.keys(schema.properties || {}));
    for (const k of Object.keys(value)) {
      if (!known.has(k)) {
        errors.push({ path: `${path}/${k}`, field: k, message: `unknown field ${k} (additionalProperties false)` });
      }
    }
  }
  if (schema.properties && value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, sub] of Object.entries(schema.properties)) {
      if (k in value) walk(sub, value[k], `${path}/${k}`, errors);
    }
  }
  if (schema.items && Array.isArray(value)) {
    value.forEach((v, i) => walk(schema.items, v, `${path}/${i}`, errors));
  }
}

function checkType(type, value) {
  const types = Array.isArray(type) ? type : [type];
  return types.some((t) => matchType(t, value));
}

function matchType(t, value) {
  if (t === 'null') return value === null;
  if (t === 'array') return Array.isArray(value);
  if (t === 'object') return typeof value === 'object' && value !== null && !Array.isArray(value);
  if (t === 'integer') return Number.isInteger(value);
  if (t === 'number') return typeof value === 'number';
  if (t === 'string') return typeof value === 'string';
  if (t === 'boolean') return typeof value === 'boolean';
  return false;
}

function jsType(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}
