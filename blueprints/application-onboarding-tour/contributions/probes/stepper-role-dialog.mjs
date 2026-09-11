// application-onboarding-tour probe: step tooltip carries
// role="dialog" (AC-26102-1). Server-side observable: the client
// script's BREAK constant plus the conditional statement that
// assigns role="dialog" only when BREAK !== 'no-role'. The probe
// drives two varied inputs and asserts the derived constant.

import { fixtureFetch, startFixture, excerpt } from './probe-utils.mjs';

export const anchorAcId = 'application-onboarding-tour-AC-26102-1';
export const accountBound = false;

function parseBreak(body) {
  const m = body.match(/var BREAK = ("[^"]*"|null);/);
  return m ? (m[1] === 'null' ? null : JSON.parse(m[1])) : undefined;
}

export default async function runProbe() {
  const fixture = await startFixture();
  const results = [];
  try {
    const golden = await fixtureFetch(fixture.url, '/tour');
    const goldenBreak = parseBreak(golden.body);
    const dialogAssignmentGuard = /if \(BREAK !== 'no-role'\) tip\.setAttribute\('role', 'dialog'\);/.test(golden.body);
    const goldenPass = golden.status === 200 && !!golden.requestId && (goldenBreak === '' || goldenBreak === null) && dialogAssignmentGuard;
    results.push({
      anchorAcId,
      verdict: goldenPass ? 'pass' : 'fail',
      detail: goldenPass
        ? `GET /tour returned 200; client script's BREAK constant is ${JSON.stringify(goldenBreak)} (no break in effect) and the guard that assigns role="dialog" on the tooltip is present in the script; x-fixture-request-id=${golden.requestId}`
        : `golden evidence gap: status=${golden.status} rid=${golden.requestId} break=${JSON.stringify(goldenBreak)} guard=${dialogAssignmentGuard}`,
      evidence: {
        requestId: golden.requestId,
        responseStatus: golden.status,
        bodyExcerpt: excerpt((golden.body.match(/var BREAK = [^;]+;[^]{0,80}/) || [''])[0]),
        derived: { break: goldenBreak, dialogAssignmentGuard },
      },
    });

    const broken = await fixtureFetch(fixture.url, '/tour?break=no-role');
    const brokenBreak = parseBreak(broken.body);
    const varyPass = broken.status === 200 && !!broken.requestId && brokenBreak === 'no-role';
    results.push({
      anchorAcId,
      verdict: varyPass ? 'pass' : 'fail',
      detail: varyPass
        ? `GET /tour?break=no-role returned 200; client script's BREAK constant is "no-role" (varied input reflected), so the tooltip will be created without role="dialog"; the AC-26102-1 role-check would refuse; x-fixture-request-id=${broken.requestId}`
        : `break=no-role evidence gap: status=${broken.status} rid=${broken.requestId} brokenBreak=${brokenBreak}`,
      evidence: {
        requestId: broken.requestId,
        responseStatus: broken.status,
        bodyExcerpt: excerpt((broken.body.match(/var BREAK = [^;]+;[^]{0,60}/) || [''])[0]),
        derived: { brokenBreak },
      },
    });
  } finally {
    await fixture.kill();
  }
  return { results };
}
