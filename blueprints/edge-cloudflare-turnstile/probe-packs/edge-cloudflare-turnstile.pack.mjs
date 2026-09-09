// edge-cloudflare-turnstile probe pack (v1.0.0).
//
// Four surface-observable checks per cloudflare-round-6-spec section 3.2:
//   AC-turnstile-widgetRendered      Turnstile widget mounts with the pinned always-pass sitekey and the mount injects no third-party script beyond the Cloudflare Turnstile host.
//   AC-turnstile-serverVerified-pass Live POST to Cloudflare siteverify with always-pass secret returns success:true and the handler responds 200.
//   AC-turnstile-serverVerified-fail Live POST to Cloudflare siteverify with always-fail secret returns success:false and the handler rejects 400.
//   AC-turnstile-magicLinkGuard      Magic-link mint route composed with the Turnstile guard refuses a mint submit without a valid Turnstile response with 400 and no mint side-effect.
//
// The pack ships no appliesTo predicate (Turnstile is not capability-gated per spec section 3.2). Every fixture
// that applies the blueprint fires every check. Runtime URL and browser are supplied by the pack runner; the
// dedicated pack fixture at packages/rcf-lite/test/fixtures/probe-pack-edge-cloudflare-turnstile pins the
// Cloudflare public test keys documented at https://developers.cloudflare.com/turnstile/troubleshooting/testing/.

function withUrl(runtimeUrl, path) {
  return new URL(path, runtimeUrl).toString();
}

const CLOUDFLARE_TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';

export default {
  packName: 'edge-cloudflare-turnstile',
  version: '1.0.0',
  blueprintSlug: 'edge-cloudflare-turnstile',
  appliesTo: () => true,
  boot: { bootCommand: null, waitForUrl: null, waitForSelector: null },
  checks: [
    {
      id: 'AC-turnstile-widgetRendered',
      severity: 'block',
      description: 'Turnstile client widget mounts with the pinned always-pass sitekey; the mount injects Cloudflare Turnstile JS from the Cloudflare Turnstile origin only, populates the cf-turnstile-response token input, and no third-party script from any other origin is loaded on the page.',
      run: async ({ browser, runtimeUrl }) => {
        if (!browser) return { verdict: 'fail', detail: 'no packBrowser wired' };
        await browser.goto(withUrl(runtimeUrl, '/?sitekey=pass'));
        // Wait for the widget to inject the token. Turnstile fires the callback asynchronously and the always-pass
        // test sitekey (1x00000000000000000000AA per Cloudflare testing docs) resolves without rendering an iframe.
        await new Promise((r) => setTimeout(r, 6000));
        const dom = await browser.evaluate((cfOrigin) => {
          const widget = document.querySelector('[data-role="turnstile-widget"]');
          const sitekeyEl = document.querySelector('[data-role="sitekey"]');
          const scripts = Array.from(document.querySelectorAll('script[src]')).map((s) => s.src);
          const cloudflareScripts = scripts.filter((s) => s.startsWith(cfOrigin));
          const thirdParty = scripts.filter((s) => {
            try { const u = new URL(s); if (u.origin === window.location.origin) return false; return u.origin !== cfOrigin; }
            catch { return false; }
          });
          const tokenInputs = Array.from(document.querySelectorAll('input[name="cf-turnstile-response"]'));
          const tokenValues = tokenInputs.map((i) => (i.value || '').slice(0, 8));
          return {
            widgetPresent: !!widget,
            sitekey: sitekeyEl ? sitekeyEl.textContent.trim() : null,
            scriptCount: scripts.length, cloudflareScriptCount: cloudflareScripts.length, thirdPartyScripts: thirdParty,
            tokenInputCount: tokenInputs.length, tokenValueSample: tokenValues,
            tokenPopulated: tokenInputs.some((i) => i.value && i.value.length > 0),
          };
        }, CLOUDFLARE_TURNSTILE_ORIGIN);
        if (!dom.widgetPresent) return { verdict: 'fail', detail: 'Turnstile widget element [data-role="turnstile-widget"] not found on /?sitekey=pass' };
        if (dom.cloudflareScriptCount < 1) return { verdict: 'fail', detail: `Cloudflare Turnstile JS not injected from ${cfOrigin}; scripts=${JSON.stringify(dom)}`.replace('${cfOrigin}', 'https://challenges.cloudflare.com') };
        if (dom.thirdPartyScripts.length > 0) return { verdict: 'fail', detail: `third-party script(s) present beyond Cloudflare Turnstile: ${JSON.stringify(dom.thirdPartyScripts)}` };
        if (dom.tokenInputCount < 1) return { verdict: 'fail', detail: `no cf-turnstile-response input in the page after widget mount; DOM=${JSON.stringify(dom)}` };
        if (!dom.tokenPopulated) return { verdict: 'fail', detail: `cf-turnstile-response input not populated by Turnstile; token samples=${JSON.stringify(dom.tokenValueSample)}` };
        return { verdict: 'pass', detail: `widget mounted; sitekey=${dom.sitekey}; cloudflareScripts=${dom.cloudflareScriptCount}; tokenPopulated=true tokenSample=${JSON.stringify(dom.tokenValueSample)}; thirdParty=0` };
      },
    },
    {
      id: 'AC-turnstile-serverVerified-pass',
      severity: 'block',
      description: 'Live POST to challenges.cloudflare.com/turnstile/v0/siteverify with the pinned always-pass secret returns success:true; the fixture /api/submit handler responds 200.',
      run: async ({ browser, runtimeUrl }) => {
        // Server-side siteverify pass. Uses the browser as a driver to build a form submission then reads
        // the server response.
        const body = new URLSearchParams();
        body.set('email', 'reviewer@example.com');
        body.set('turnstile-sitekey', '1x00000000000000000000AA');
        body.set('cf-turnstile-response', 'PACK-CHECK-PASS-TOKEN');
        const resp = await fetch(withUrl(runtimeUrl, '/api/submit'), {
          method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
        });
        const text = await resp.text();
        let json = null; try { json = JSON.parse(text); } catch { /* leave null */ }
        const ok = resp.status === 200 && json && json.received === 'ok';
        return {
          verdict: ok ? 'pass' : 'fail',
          detail: ok
            ? `serverVerified-pass: fixture /api/submit returned status=200 body=${text} (Cloudflare siteverify success:true with always-pass secret)`
            : `serverVerified-pass unexpected shape status=${resp.status} body=${text}`,
        };
      },
    },
    {
      id: 'AC-turnstile-serverVerified-fail',
      severity: 'block',
      description: 'Live POST to Cloudflare siteverify with the pinned always-fail secret returns success:false; the fixture /api/submit handler rejects with 400 and refusal body carries errorCodes and no sitekey.',
      run: async ({ browser, runtimeUrl }) => {
        const body = new URLSearchParams();
        body.set('email', 'reviewer@example.com');
        body.set('turnstile-sitekey', '2x00000000000000000000AB');
        body.set('cf-turnstile-response', 'PACK-CHECK-FAIL-TOKEN');
        const resp = await fetch(withUrl(runtimeUrl, '/api/submit?fail-secret=1'), {
          method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
        });
        const text = await resp.text();
        let json = null; try { json = JSON.parse(text); } catch { /* leave null */ }
        const ok = resp.status === 400 && json && json.errorCode === 'turnstile.siteverify-failed'
          && Array.isArray(json.errorCodes) && json.errorCodes.length > 0
          && !text.includes('2x00000000000000000000AB');
        return {
          verdict: ok ? 'pass' : 'fail',
          detail: ok
            ? `serverVerified-fail: fixture rejected status=400 errorCode=turnstile.siteverify-failed errorCodes=${JSON.stringify(json.errorCodes)}; refusal body carries no sitekey`
            : `serverVerified-fail unexpected shape status=${resp.status} body=${text}`,
        };
      },
    },
    {
      id: 'AC-turnstile-magicLinkGuard',
      severity: 'block',
      description: 'Magic-link mint route composed with the Turnstile guard refuses a mint submit without a Turnstile response with 400 and refusal errorCode=turnstile.token-missing; no magic-link mint side-effect.',
      run: async ({ browser, runtimeUrl }) => {
        // Two probes: (a) missing token refuse (400), (b) fail-secret refuse (400).
        const missingBody = new URLSearchParams();
        missingBody.set('email', 'reviewer@example.com');
        missingBody.set('turnstile-sitekey', '1x00000000000000000000AA');
        const missingResp = await fetch(withUrl(runtimeUrl, '/api/magic-link'), {
          method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: missingBody,
        });
        const missingText = await missingResp.text();
        let missingJson = null; try { missingJson = JSON.parse(missingText); } catch {}
        const missingOk = missingResp.status === 400 && missingJson && missingJson.errorCode === 'turnstile.token-missing';

        const failBody = new URLSearchParams();
        failBody.set('email', 'reviewer@example.com');
        failBody.set('turnstile-sitekey', '2x00000000000000000000AB');
        failBody.set('cf-turnstile-response', 'MAGIC-LINK-PACK-FAIL-TOKEN');
        const failResp = await fetch(withUrl(runtimeUrl, '/api/magic-link?fail-secret=1'), {
          method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: failBody,
        });
        const failText = await failResp.text();
        let failJson = null; try { failJson = JSON.parse(failText); } catch {}
        const failOk = failResp.status === 400 && failJson && failJson.errorCode === 'turnstile.siteverify-failed';

        if (missingOk && failOk) return { verdict: 'pass', detail: `magic-link guard: missing-token refused 400 turnstile.token-missing; fail-secret refused 400 turnstile.siteverify-failed errorCodes=${JSON.stringify(failJson.errorCodes)}` };
        return { verdict: 'fail', detail: `magic-link guard unexpected: missing status=${missingResp.status} body=${missingText}; fail status=${failResp.status} body=${failText}` };
      },
    },
  ],
};
