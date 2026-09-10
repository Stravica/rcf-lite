// Probe: manifest-schema-validate.
//
// anchorAcId list (multi):
// - AC-tunnel-manifestSchema (primary)
// - AC-tunnel-noPublicOrigin (refuses ingress rules whose service URL
//   binds to a host public interface)
// - AC-tunnel-credentialsDiscipline (refuses when credentials are inlined
//   instead of via secretRef; runs an event-secrecy scan on the
//   fixture credentials placeholder body)
// accountBound: false.
//
// Verdict is a pure function of the files at fixtureRoot() (default: the
// canonical fixture; a fixture-side delegate points FIXTURE_ROOT at a
// scratch dir with a mutation applied). The probe module reads no
// fixture-side mutation env var and does not branch on being under mutation.

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runShim, fixtureRoot, parseTunnelYaml, pairs } from './probe-utils.mjs';

export const anchorAcIds = [
  'AC-tunnel-manifestSchema',
  'AC-tunnel-noPublicOrigin',
  'AC-tunnel-credentialsDiscipline',
];
export const accountBound = false;

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(HERE, 'tunnel-manifest.schema.json');

function validateAgainstSchema(doc, schema) {
  // Minimal Ajv-free walker sufficient for this schema. Returns an array
  // of violation strings.
  const errors = [];
  function walk(node, sub, pathHint) {
    if (sub.type === 'object' && sub.properties) {
      if (typeof node !== 'object' || node === null || Array.isArray(node)) {
        errors.push(`${pathHint}: expected object, got ${node === null ? 'null' : Array.isArray(node) ? 'array' : typeof node}`);
        return;
      }
      for (const key of sub.required ?? []) {
        if (!(key in node)) errors.push(`${pathHint}: missing required field '${key}'`);
      }
      if (sub.additionalProperties === false) {
        for (const key of Object.keys(node)) {
          if (!(key in (sub.properties ?? {}))) errors.push(`${pathHint}: unknown field '${key}'`);
        }
      }
      for (const [key, subsub] of Object.entries(sub.properties)) {
        if (key in node) walk(node[key], subsub, `${pathHint}.${key}`);
      }
    } else if (sub.type === 'array') {
      if (!Array.isArray(node)) {
        errors.push(`${pathHint}: expected array, got ${typeof node}`);
        return;
      }
      if (typeof sub.minItems === 'number' && node.length < sub.minItems) {
        errors.push(`${pathHint}: expected at least ${sub.minItems} item(s), got ${node.length}`);
      }
      if (sub.items) {
        node.forEach((item, i) => walk(item, sub.items, `${pathHint}[${i}]`));
      }
    } else if (sub.type === 'string') {
      if (typeof node !== 'string') {
        errors.push(`${pathHint}: expected string, got ${typeof node}`);
        return;
      }
      if (typeof sub.minLength === 'number' && node.length < sub.minLength) {
        errors.push(`${pathHint}: expected minLength ${sub.minLength}, got ${node.length}`);
      }
      if (sub.pattern && !(new RegExp(sub.pattern).test(node))) {
        errors.push(`${pathHint}: value '${node}' does not match pattern ${sub.pattern}`);
      }
    } else if (sub.type === 'boolean') {
      if (typeof node !== 'boolean') errors.push(`${pathHint}: expected boolean`);
    }
  }
  walk(doc, schema, 'manifest');
  return errors;
}

function refuseOriginPortRules(doc) {
  // A service URL that binds to a host public interface is a policy
  // violation for a tunnel-only apply (no reverse proxy). The catch-all
  // http_status:N is exempt.
  const violations = [];
  const rules = Array.isArray(doc.ingress) ? doc.ingress : [];
  for (let i = 0; i < rules.length; i += 1) {
    const rule = rules[i] ?? {};
    const svc = String(rule.service ?? '');
    if (svc.startsWith('http_status:')) continue;
    const m = svc.match(/^https?:\/\/([^\/:]+)(:\d+)?(\/.*)?$/);
    if (!m) {
      violations.push(`ingress[${i}] service '${svc}' does not match the internal-address shape (expected http(s)://<internal-name>[:port]/...)`);
      continue;
    }
    const host = m[1];
    if (host === '0.0.0.0' || host === '') {
      violations.push(`ingress[${i}] service '${svc}' binds to a host public interface (${host || 'empty'}); tunnel-only apply requires internal addresses only`);
      continue;
    }
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host) && host !== '127.0.0.1') {
      violations.push(`ingress[${i}] service '${svc}' binds to a numeric IP that is not loopback; tunnel-only apply requires internal names or loopback`);
    }
  }
  return violations;
}

async function eventSecrecyScan(credentialsPath) {
  let creds;
  try {
    creds = JSON.parse(await readFile(credentialsPath, 'utf8'));
  } catch (err) {
    return {
      verdict: 'fail',
      detail: `credentials placeholder read failed at ${credentialsPath}: ${err.message}. Fix the fixture setup step (packages/rcf-lite/test/fixtures/hetzner-throwaway-server/cloudflared/*/credentials/probe.json.example must exist and parse as JSON) before re-running the probe. A missing placeholder is a fixture-setup defect, not an event-secrecy warning.`,
    };
  }
  const eventBody = {
    kind: 'cloudflaredReady',
    connectorId: 'sha256:fixture-connector',
    region: 'fixture-region',
    version: '2026.8.3',
    // A fixture-side mutation may seed a _leakedEvent object which the
    // probe surfaces by including it in the synthetic event body.
    ...(creds._leakedEvent ?? {}),
  };
  const body = JSON.stringify(eventBody);
  const leaks = [];
  for (const [k, v] of Object.entries(creds)) {
    if (k === '_comment' || k === '_leakedEvent') continue;
    if (typeof v !== 'string' || v.length < 8) continue;
    if (body.includes(v)) leaks.push(`event body carries credentials.${k} literal`);
  }
  if (leaks.length) {
    return { verdict: 'fail', detail: `event-secrecy scan FAILED: ${leaks.join('; ')}` };
  }
  return { verdict: 'pass', detail: 'event-secrecy scan clean; cloudflaredReady body carries metadata only' };
}

export default async function runProbe() {
  const results = [];
  const extra = {};
  const root = fixtureRoot();
  extra.fixtureRoot = root;
  const schema = JSON.parse(await readFile(SCHEMA_PATH, 'utf8'));
  extra.schemaId = schema.$id;
  for (const { runtime, mode } of pairs()) {
    const manifestPath = resolve(root, runtime, 'cloudflare/tunnels', `${mode}.yaml`);
    let text;
    try {
      text = await readFile(manifestPath, 'utf8');
    } catch (err) {
      results.push({
        anchorAcId: 'AC-tunnel-manifestSchema',
        verdict: 'fail',
        detail: `${runtime}/${mode}: manifest read failed at ${manifestPath}: ${err.message}`,
      });
      continue;
    }
    const doc = parseTunnelYaml(text);
    const schemaErrors = validateAgainstSchema(doc, schema);
    if (schemaErrors.length) {
      results.push({
        anchorAcId: 'AC-tunnel-manifestSchema',
        verdict: 'fail',
        detail: `${runtime}/${mode}: schema violation(s): ${schemaErrors.slice(0, 5).join('; ')}${schemaErrors.length > 5 ? ` (+${schemaErrors.length - 5} more)` : ''}`,
      });
    } else {
      results.push({
        anchorAcId: 'AC-tunnel-manifestSchema',
        verdict: 'pass',
        detail: `${runtime}/${mode}: manifest at ${manifestPath} validates against tunnel-manifest.schema.json`,
      });
    }
    const rulesForCatchall = Array.isArray(doc.ingress) ? doc.ingress : [];
    const lastRule = rulesForCatchall[rulesForCatchall.length - 1];
    if (!lastRule || typeof lastRule.service !== 'string' || !lastRule.service.startsWith('http_status:')) {
      results.push({
        anchorAcId: 'AC-tunnel-manifestSchema',
        verdict: 'fail',
        detail: `${runtime}/${mode}: last ingress rule must be a catch-all http_status:N (found: ${lastRule ? JSON.stringify(lastRule).slice(0, 120) : '(no ingress rules)'})`,
      });
    }
    const originViolations = refuseOriginPortRules(doc);
    if (originViolations.length) {
      results.push({
        anchorAcId: 'AC-tunnel-noPublicOrigin',
        verdict: 'fail',
        detail: `${runtime}/${mode}: ${originViolations.join('; ')}`,
      });
    } else {
      results.push({
        anchorAcId: 'AC-tunnel-noPublicOrigin',
        verdict: 'pass',
        detail: `${runtime}/${mode}: every ingress service URL binds to an internal address; no host public port exposed`,
      });
    }
    const cred = doc.credentialsFile;
    if (!cred || typeof cred !== 'object' || Array.isArray(cred)) {
      results.push({
        anchorAcId: 'AC-tunnel-credentialsDiscipline',
        verdict: 'fail',
        detail: `${runtime}/${mode}: credentialsFile must be an object with a secretRef`,
      });
    } else if (!('secretRef' in cred) || typeof cred.secretRef !== 'string' || !cred.secretRef.length) {
      results.push({
        anchorAcId: 'AC-tunnel-credentialsDiscipline',
        verdict: 'fail',
        detail: `${runtime}/${mode}: credentialsFile.secretRef is required (found keys: ${Object.keys(cred).join(', ') || '(none)'})`,
      });
    } else if ('AccountTag' in cred || 'TunnelSecret' in cred || 'TunnelID' in cred) {
      results.push({
        anchorAcId: 'AC-tunnel-credentialsDiscipline',
        verdict: 'fail',
        detail: `${runtime}/${mode}: credentialsFile carries an inline JSON body (bypasses secretRef)`,
      });
    } else {
      results.push({
        anchorAcId: 'AC-tunnel-credentialsDiscipline',
        verdict: 'pass',
        detail: `${runtime}/${mode}: credentialsFile.secretRef = ${cred.secretRef}`,
      });
    }
    const credPath = resolve(root, runtime, 'credentials/probe.json.example');
    const scan = await eventSecrecyScan(credPath);
    results.push({ anchorAcId: 'AC-tunnel-credentialsDiscipline', ...scan });
    extra[`${runtime}/${mode}`] = { tunnel: doc.tunnel, ingressCount: Array.isArray(doc.ingress) ? doc.ingress.length : 0 };
  }
  return { results, extra };
}

const engine = { kind: 'schema-validate', image: 'edge-cloudflare-tunnel manifest schema (Ajv-free walker)', healthy: true };
if (import.meta.url === `file://${process.argv[1]}`) {
  await runShim('manifest-schema-validate', engine, runProbe);
}
