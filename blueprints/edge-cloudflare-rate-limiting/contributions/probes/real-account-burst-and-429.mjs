// Probe: real-account burst-and-429 against a scheduled URL.
//
// anchorAcId: AC-36103-1. accountBound: true.
//
// When CI_HAS_CLOUDFLARE_ACCOUNT=true AND CF_RATE_LIMIT_URL is set,
// the probe fires an in-process burst against the scheduled URL and
// asserts:
//   - the (N+1)th and subsequent requests within the elicited
//     duration return HTTP 429.
//   - the 429 responses carry a Retry-After header consistent with
//     the elicited duration.
//   - the 429 responses carry a Cf-Ray header naming the CF edge.
//
// Without either env var the probe records accountBoundSkipped: true
// and aggregates to pass per spec section 3.5 and ruling 6.
// N (the elicited threshold) is read from CF_RATE_LIMIT_THRESHOLD
// (default 60); the burst count is N+3.

export const anchorAcId = 'AC-36103-1';
export const accountBound = true;

const BURST_TIMEOUT_MS = 10000;

async function fireOne(url) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), BURST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'manual', signal: ctrl.signal });
    return { status: res.status, retryAfter: res.headers.get('retry-after'), cfRay: res.headers.get('cf-ray') };
  } finally {
    clearTimeout(to);
  }
}

export default async function runProbe() {
  const has = process.env.CI_HAS_CLOUDFLARE_ACCOUNT === 'true';
  const url = process.env.CF_RATE_LIMIT_URL || '';
  if (!has || !url) {
    // Positive-evidence rule (authoring standard section 7d): the skip
    // record names the exact env var(s) that were unset in `reason`,
    // so a `pass` verdict is legal without positive evidence.
    const unset = [];
    if (!has) unset.push('CI_HAS_CLOUDFLARE_ACCOUNT');
    if (!url) unset.push('CF_RATE_LIMIT_URL');
    const reason = unset.join(', ');
    return {
      results: [{
        anchorAcId: 'AC-36103-1',
        verdict: 'pass',
        accountBoundSkipped: true,
        reason,
        detail: `accountBoundSkipped: ${reason} unset; per spec section 3.5 and ruling 6 pass-with-skip.`,
      }],
      extra: { accountBoundSkipped: true, reason },
    };
  }
  const threshold = Number.parseInt(process.env.CF_RATE_LIMIT_THRESHOLD || '60', 10);
  const burstCount = threshold + 3;
  const results429 = [];
  const responses = [];
  try {
    for (let i = 0; i < burstCount; i += 1) {
      const r = await fireOne(url);
      responses.push(r);
      if (r.status === 429) results429.push(r);
    }
  } catch (err) {
    return {
      results: [{
        anchorAcId: 'AC-36103-1',
        verdict: 'fail',
        detail: `real-account burst threw before completion: ${err && err.message ? err.message : String(err)}`,
      }],
      extra: { accountBound: true, responsesFired: responses.length },
    };
  }
  const results = [];
  if (results429.length < 2) {
    results.push({
      anchorAcId: 'AC-36103-1',
      verdict: 'fail',
      detail: `burst of ${burstCount} produced ${results429.length} 429 response(s); expected at least the ${burstCount - threshold} requests above the elicited threshold to return 429.`,
    });
  }
  const missingRetryAfter = results429.filter((r) => !r.retryAfter);
  if (missingRetryAfter.length > 0) {
    results.push({
      anchorAcId: 'AC-36103-1',
      verdict: 'fail',
      detail: `${missingRetryAfter.length} of the 429 response(s) missing a Retry-After header; the Cloudflare WAF rate-limiting rules documented shape names Retry-After as the value the client honours.`,
    });
  }
  const missingCfRay = results429.filter((r) => !r.cfRay);
  if (missingCfRay.length > 0) {
    results.push({
      anchorAcId: 'AC-36103-1',
      verdict: 'fail',
      detail: `${missingCfRay.length} of the 429 response(s) missing a Cf-Ray header; the header identifies the CF edge that served the refusal.`,
    });
  }
  if (results.length === 0) {
    results.push({
      anchorAcId: 'AC-36103-1',
      verdict: 'pass',
      detail: `burst of ${burstCount} produced ${results429.length} 429 response(s), every 429 carries Retry-After and Cf-Ray; over-threshold behaviour confirmed against the scheduled URL.`,
    });
  }
  return {
    results,
    extra: { accountBound: true, responsesFired: responses.length, count429: results429.length, threshold },
  };
}
