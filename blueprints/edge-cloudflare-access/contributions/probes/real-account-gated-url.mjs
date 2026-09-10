// Probe: real-account gated URL round-trip against a scheduled Access-configured hostname.
// anchorAcId: AC-34109-1. accountBound: true.
//
// When CI_HAS_CLOUDFLARE_ACCOUNT and CF_ACCESS_HOST are set, the probe fetches
// https://<host>/ with redirects disabled and walks up to five redirect hops,
// asserting the terminal Location points at https://<team>.cloudflareaccess.com/.
// Without either env var the probe records accountBoundSkipped: true and
// aggregates to pass per spec section 3.5 (pass-with-skip).

export const anchorAcId = 'AC-34109-1';
export const accountBound = true;

const MAX_HOPS = 5;

async function walkRedirects(url) {
  const chain = [];
  let current = url;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const res = await fetch(current, { redirect: 'manual' });
    const location = res.headers.get('location');
    chain.push({ url: current, status: res.status, location });
    if (res.status < 300 || res.status >= 400 || !location) break;
    current = new URL(location, current).toString();
  }
  return { chain, terminal: chain[chain.length - 1] };
}

export default async function runProbe() {
  const has = process.env.CI_HAS_CLOUDFLARE_ACCOUNT === 'true';
  const host = process.env.CF_ACCESS_HOST || '';
  if (!has || !host) {
    // Positive-evidence rule (authoring standard section 7d): the skip
    // record names the exact env var(s) that were unset in `reason`,
    // so a `pass` verdict is legal without positive evidence.
    const unset = [];
    if (!has) unset.push('CI_HAS_CLOUDFLARE_ACCOUNT');
    if (!host) unset.push('CF_ACCESS_HOST');
    const reason = unset.join(', ');
    return {
      results: [{
        anchorAcId: 'AC-34109-1',
        verdict: 'pass',
        accountBoundSkipped: true,
        reason,
        detail: `accountBoundSkipped: ${reason} unset; per spec section 3.5 pass-with-skip.`,
      }],
      extra: { accountBoundSkipped: true, reason },
    };
  }
  try {
    const { chain, terminal } = await walkRedirects(`https://${host}/`);
    const terminalUrl = terminal.location ?? terminal.url;
    const ok = /https?:\/\/[a-z0-9-]+\.cloudflareaccess\.com/i.test(terminalUrl);
    return {
      results: [{
        anchorAcId: 'AC-34109-1',
        verdict: ok ? 'pass' : 'fail',
        detail: ok
          ? `redirect chain terminated at cloudflareaccess.com; hops=${chain.length} terminal=${terminalUrl}`
          : `redirect chain did not terminate at cloudflareaccess.com; chain=${JSON.stringify(chain)}`,
      }],
      extra: { accountBound: true, chainLength: chain.length },
    };
  } catch (err) {
    return {
      results: [{
        anchorAcId: 'AC-34109-1',
        verdict: 'fail',
        detail: `real-account probe threw: ${err && err.message ? err.message : String(err)}`,
      }],
    };
  }
}
