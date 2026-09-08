// hcloud CLI mock shim.
//
// A pure-Node dispatcher that returns fixture JSON for the four
// hcloud subcommands the provisioner facade shells to: server
// create, server list, image create-image, image list, server
// delete, plus firewall create + firewall apply-to-resource. The
// facade shells to hcloud via child_process.spawn; the dry-run
// probe injects this mock as the shell target so no real API call
// fires.
//
// SIMULATE_HARDENING_DRIFT / SIMULATE_MANIFEST_INVALID are not
// consulted here; they belong to the render-lint and schema-validate
// probes respectively. This module carries its own mutation switch:
// SIMULATE_JSON_PARSE_STRIP=true returns valid but non-JSON stdout
// for `hcloud server create --output json` so the facade's JSON
// parser fails and the dry-run-mock probe FAILS.

import { randomBytes } from 'node:crypto';

function newId() {
  return Number.parseInt(randomBytes(3).toString('hex'), 16);
}

function newIpv4() {
  return `198.51.100.${1 + (Math.floor(Math.random() * 250))}`;
}

export function invokeHcloudMock(argv) {
  // argv is [subcommand, resource, ...args]. We just care about the
  // shape the facade issues: [resource, verb, ...] plus a trailing
  // '--output', 'json' pair.
  const [resource, verb, ...rest] = argv;
  const args = parseArgs(rest);
  const output = args['--output'] ?? 'text';
  if (output !== 'json') {
    return { stdout: `not-implemented in mock: --output ${output}\n`, stderr: '', code: 1 };
  }
  if (resource === 'server' && verb === 'create') {
    if (process.env.SIMULATE_JSON_PARSE_STRIP === 'true') {
      return { stdout: 'not json at all, defensive-fake output', stderr: '', code: 0 };
    }
    return {
      stdout: JSON.stringify({
        server: {
          id: newId(),
          name: args['--name'] ?? 'unnamed',
          serverType: { name: args['--type'] ?? 'cx23' },
          datacenter: { location: { name: args['--location'] ?? 'fsn1' } },
          publicNet: { ipv4: { ip: newIpv4() } },
          labels: parseLabels(args['--label']),
        },
      }) + '\n',
      stderr: '',
      code: 0,
    };
  }
  if (resource === 'server' && verb === 'list') {
    return {
      stdout: JSON.stringify([]) + '\n',
      stderr: '',
      code: 0,
    };
  }
  if (resource === 'server' && verb === 'delete') {
    return { stdout: JSON.stringify({ ok: true }) + '\n', stderr: '', code: 0 };
  }
  if (resource === 'image' && verb === 'create-image') {
    return {
      stdout: JSON.stringify({
        image: {
          id: newId(),
          description: args['--description'] ?? 'snapshot',
          createdFrom: { id: Number.parseInt(args['--server'] ?? '0', 10) },
          created: new Date().toISOString(),
          labels: parseLabels(args['--label']),
        },
      }) + '\n',
      stderr: '',
      code: 0,
    };
  }
  if (resource === 'image' && verb === 'list') {
    return { stdout: JSON.stringify([]) + '\n', stderr: '', code: 0 };
  }
  if (resource === 'firewall' && (verb === 'create' || verb === 'apply-to-resource')) {
    return {
      stdout: JSON.stringify({ firewall: { id: newId(), name: args['--name'] ?? 'unnamed' } }) + '\n',
      stderr: '',
      code: 0,
    };
  }
  return { stdout: '', stderr: `unknown mock verb: ${resource} ${verb}\n`, code: 1 };
}

function parseArgs(argv) {
  const out = {};
  const labels = [];
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--label') {
      labels.push(argv[i + 1]);
      i += 1;
      continue;
    }
    if (flag && flag.startsWith('--')) {
      out[flag] = argv[i + 1];
      i += 1;
    }
  }
  if (labels.length > 0) out['--label'] = labels;
  return out;
}

function parseLabels(labelArg) {
  if (!labelArg) return {};
  const arr = Array.isArray(labelArg) ? labelArg : [labelArg];
  const out = {};
  for (const s of arr) {
    const [k, v] = String(s).split('=');
    if (k) out[k] = v ?? '';
  }
  return out;
}
