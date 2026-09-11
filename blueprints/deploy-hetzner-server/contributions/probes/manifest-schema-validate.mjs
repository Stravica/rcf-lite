// Probe: manifest schema validate (v1.1.8).
//
// This is an offline schema validator: it reads the shipped fixture
// manifests and checks them against `hetzner-server.schema.json`.
// It has no engine-minted identifier - the sha256 of a manifest is
// computed by this probe with Node's `createHash` and therefore
// does not satisfy the semantic anatomy identifier rule; the
// manifest name and JSON path are the probe's own choices.
// Every result row is a `conformanceOnly` de-claim naming the
// shipped AC clause the offline check does not observe:
//
//   - AC-37102-1  general nine-required-fields schema shape,
//   - AC-37106-1  firewall rule shape (ssh restricted, 80/443 open,
//                 no other inbound),
//   - AC-37107-1  snapshotCadence enum {weekly, daily, off}.
//
// A single manifest emits ONE row per property, each carrying its
// own `evidence` object. The hash of the manifest bytes and the
// validator output stay on the row as derived context.
//
// Purity: no process.env.SIMULATE_ switch is read. Fixture-side
// mutations live in the fixture-side run-manifest-schema-validate.mjs
// shim; the probe reads only the schema and manifest tree.

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readManifestFiles, SCHEMA_PATH } from './probe-utils.mjs';

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export const anchorAcId = null;
export const accountBound = false;

const NINE_REQUIRED = [
  'name', 'serverType', 'location', 'image', 'sshKeyIds',
  'firewallId', 'cloudInitPath', 'labels', 'firewallRules', 'snapshotCadence',
];

const LIMIT_37102 = 'AC-37102-1: manifest schema shape is validated offline against the shipped hetzner-server.schema.json; the live observation (a real-account apply that consumes the same manifest) is carried by real-account-throwaway-server-provision.';
const LIMIT_37106 = 'AC-37106-1: firewall rule shape is validated offline against the shipped schema and the TAC-3804 binding; the live-account observation (a `hcloud firewall describe` on the applied firewall) would live on a real-account firewall probe.';
const LIMIT_37107 = 'AC-37107-1: snapshotCadence enum is validated offline against the shipped schema enum; the live observation (a real-account server label matching the manifest cadence) lives on real-account-snapshot-on-demand.';

export default async function runProbe() {
  const schema = JSON.parse(await readFile(SCHEMA_PATH, 'utf8'));
  const { present, files } = await readManifestFiles();
  if (!present) {
    return {
      results: [{
        anchorAcId: null,
        conformanceOnly: true,
        limitation: LIMIT_37102,
        verdict: 'fail',
        detail: 'offline manifest scan: fixture hetzner/servers/ holds zero JSON files; ship at least ci-throwaway.json.',
        evidence: { manifestCount: 0 },
      }],
    };
  }
  const results = [];
  for (const f of files) {
    const manifestSha256 = sha256(f.text);
    let doc;
    try {
      doc = JSON.parse(f.text);
    } catch (err) {
      results.push({
        anchorAcId: null,
        conformanceOnly: true,
        limitation: LIMIT_37102,
        verdict: 'fail',
        detail: `offline manifest scan: manifest ${f.name} does not parse: ${err.message}`,
        evidence: { manifestSha256, manifestName: f.name, parseError: err.message },
      });
      continue;
    }
    const errors = validate(schema, doc, `#/${f.name}`);
    // General schema errors that are neither firewall- nor snapshot-
    // scoped anchor to AC-37102-1 (as their limitation).
    const generalErrors = errors.filter((e) => (
      e.field !== 'firewallRules' && !(e.path || '').includes('firewallRules')
      && e.field !== 'snapshotCadence' && !(e.path || '').includes('snapshotCadence')
    ));
    if (generalErrors.length > 0) {
      for (const e of generalErrors) {
        results.push({
          anchorAcId: null,
          conformanceOnly: true,
          limitation: LIMIT_37102,
          verdict: 'fail',
          detail: `offline manifest scan: manifest ${f.name} schema violation at ${e.path}: ${e.message}`,
          evidence: { manifestSha256, manifestName: f.name, jsonPath: e.path, message: e.message, field: e.field || null },
        });
      }
    } else {
      const observedKeys = Object.keys(doc).sort();
      results.push({
        anchorAcId: null,
        conformanceOnly: true,
        limitation: LIMIT_37102,
        verdict: 'pass',
        detail: `offline manifest scan: manifest ${f.name} carries the nine required fields per hetzner-server.schema.json.`,
        evidence: {
          manifestSha256,
          manifestName: f.name,
          requiredFields: NINE_REQUIRED,
          observedKeys,
        },
      });
    }
    const firewallErrors = errors.filter((e) => e.field === 'firewallRules' || (e.path || '').includes('firewallRules'));
    if (firewallErrors.length > 0) {
      for (const e of firewallErrors) {
        results.push({
          anchorAcId: null,
          conformanceOnly: true,
          limitation: LIMIT_37106,
          verdict: 'fail',
          detail: `offline firewall shape scan: manifest ${f.name} firewall rule shape violation at ${e.path}: ${e.message}`,
          evidence: { manifestSha256, manifestName: f.name, jsonPath: e.path, message: e.message },
        });
      }
    } else if (Array.isArray(doc.firewallRules)) {
      const rules = doc.firewallRules;
      const REQUIRED_BINDING = {
        ssh:   { protocol: 'tcp', direction: 'in', port: 22,  sourceMustOpen: false },
        http:  { protocol: 'tcp', direction: 'in', port: 80,  sourceMustOpen: true },
        https: { protocol: 'tcp', direction: 'in', port: 443, sourceMustOpen: true },
      };
      const nameCounts = {};
      for (const r of rules) if (r && typeof r.name === 'string') nameCounts[r.name] = (nameCounts[r.name] || 0) + 1;
      const duplicates = Object.entries(nameCounts).filter(([, n]) => n > 1).map(([n]) => n);
      const bindingErrors = [];
      const bindingEvidence = {};
      for (const [name, want] of Object.entries(REQUIRED_BINDING)) {
        const rule = rules.find((r) => r && r.name === name);
        if (!rule) {
          bindingErrors.push(`missing required rule '${name}'`);
          continue;
        }
        const observed = {
          name, protocol: rule.protocol, direction: rule.direction,
          port: rule.port, sourceIps: Array.isArray(rule.sourceIps) ? rule.sourceIps : [],
        };
        bindingEvidence[name] = observed;
        if (rule.protocol !== want.protocol) bindingErrors.push(`'${name}' protocol '${rule.protocol}' != required '${want.protocol}'`);
        if (rule.direction !== want.direction) bindingErrors.push(`'${name}' direction '${rule.direction}' != required '${want.direction}'`);
        if (rule.port !== want.port) bindingErrors.push(`'${name}' port ${rule.port} != required ${want.port}`);
        if (!Array.isArray(rule.sourceIps) || rule.sourceIps.length === 0) {
          bindingErrors.push(`'${name}' sourceIps empty or not array`);
        } else if (want.sourceMustOpen) {
          const hasOpen = rule.sourceIps.includes('0.0.0.0/0');
          if (!hasOpen) bindingErrors.push(`'${name}' must include '0.0.0.0/0' per open-service contract`);
        } else if (name === 'ssh') {
          const openLeak = rule.sourceIps.filter((s) => s === '0.0.0.0/0' || s === '::/0');
          if (openLeak.length > 0) bindingErrors.push(`'ssh' sourceIps must not include ${openLeak.join(', ')}; use operator-nominated set per TAC-3804`);
        }
      }
      if (duplicates.length > 0) bindingErrors.push(`duplicate rule names: ${duplicates.join(', ')}`);
      if (bindingErrors.length > 0) {
        results.push({
          anchorAcId: null,
          conformanceOnly: true,
          limitation: LIMIT_37106,
          verdict: 'fail',
          detail: `offline firewall shape scan: manifest ${f.name} firewall rule shape violation: ${bindingErrors.join('; ')}.`,
          evidence: {
            manifestSha256,
            manifestName: f.name,
            ruleNames: rules.map((r) => r && r.name).filter(Boolean),
            observedBinding: bindingEvidence,
            duplicates,
            errors: bindingErrors,
          },
        });
      } else {
        const ssh = rules.find((r) => r && r.name === 'ssh');
        results.push({
          anchorAcId: null,
          conformanceOnly: true,
          limitation: LIMIT_37106,
          verdict: 'pass',
          detail: `offline firewall shape scan: manifest ${f.name} firewall rule shape valid: ssh (tcp/in/22, restricted to ${(ssh && ssh.sourceIps || []).join(', ')}, no 0.0.0.0/0), http (tcp/in/80, open), https (tcp/in/443, open); no duplicates.`,
          evidence: {
            manifestSha256,
            manifestName: f.name,
            ruleNames: rules.map((r) => r && r.name).filter(Boolean),
            observedBinding: bindingEvidence,
            duplicates: [],
          },
        });
      }
    }
    const snapshotErrors = errors.filter((e) => e.field === 'snapshotCadence' || (e.path || '').includes('snapshotCadence'));
    if (snapshotErrors.length > 0) {
      for (const e of snapshotErrors) {
        results.push({
          anchorAcId: null,
          conformanceOnly: true,
          limitation: LIMIT_37107,
          verdict: 'fail',
          detail: `offline snapshotCadence scan: manifest ${f.name} snapshotCadence violation at ${e.path}: ${e.message}`,
          evidence: { manifestSha256, manifestName: f.name, jsonPath: e.path, message: e.message },
        });
      }
    } else if (typeof doc.snapshotCadence === 'string') {
      results.push({
        anchorAcId: null,
        conformanceOnly: true,
        limitation: LIMIT_37107,
        verdict: 'pass',
        detail: `offline snapshotCadence scan: manifest ${f.name} snapshotCadence "${doc.snapshotCadence}" is in the shipped enum {weekly, daily, off}.`,
        evidence: {
          manifestSha256,
          manifestName: f.name,
          snapshotCadence: doc.snapshotCadence,
          shippedEnum: ['weekly', 'daily', 'off'],
        },
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

// Draft-07 subset validator (unchanged from v1.1.3 apart from the
// caller splitting per-property).
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
    // Reject duplicate rule names (defect: firewall
    // validation must prohibit duplicates).
    const counts = {};
    for (const r of doc.firewallRules) if (r && typeof r.name === 'string') counts[r.name] = (counts[r.name] || 0) + 1;
    for (const [name, n] of Object.entries(counts)) {
      if (n > 1) {
        errors.push({
          path: `${pathPrefix}/firewallRules`,
          field: 'firewallRules',
          message: `firewallRules contains a duplicate rule named '${name}' (${n} occurrences); each of {ssh, http, https} must appear exactly once.`,
        });
      }
    }
    // Bind each required rule name to protocol/direction/port
    // (defect).
    const bindings = { ssh: { protocol: 'tcp', direction: 'in', port: 22 }, http: { protocol: 'tcp', direction: 'in', port: 80 }, https: { protocol: 'tcp', direction: 'in', port: 443 } };
    for (const [name, want] of Object.entries(bindings)) {
      const rule = doc.firewallRules.find((r) => r && r.name === name);
      if (!rule) continue;
      for (const k of ['protocol', 'direction', 'port']) {
        if (rule[k] !== want[k]) {
          errors.push({
            path: `${pathPrefix}/firewallRules/${name}/${k}`,
            field: 'firewallRules',
            message: `firewallRules '${name}' ${k} '${rule[k]}' does not match required '${want[k]}' per TAC-3804.`,
          });
        }
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
