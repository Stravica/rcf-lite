// TAC-501 magic-link manager fixture. Issues a single-use,
// TTL-bounded, cryptographically-random token bound to a principal
// email address; verifies by consuming (single-use per round-6
// contract). Uses an injectable clock so probes stay deterministic
// without SIMULATE_* switches.

import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';

export function createMagicLinkManager({ ttlSeconds = 900, clock = () => Date.now() } = {}) {
  const tokens = new Map(); // hashHex -> { emailAddress, expiresAt, consumed }

  const hash = (raw) => createHash('sha256').update(raw).digest('hex');

  return {
    async issue({ emailAddress }) {
      if (!emailAddress || !/@/.test(emailAddress)) return { ok: false, error: 'emailAddress required' };
      const raw = randomBytes(32).toString('base64url');
      const key = hash(raw);
      tokens.set(key, { emailAddress, expiresAt: clock() + ttlSeconds * 1000, consumed: false });
      return { ok: true, token: raw, expiresAt: clock() + ttlSeconds * 1000 };
    },
    async verify({ token, emailAddress }) {
      const key = hash(token);
      const rec = tokens.get(key);
      if (!rec) return { ok: false, error: 'token not found' };
      if (rec.consumed) return { ok: false, error: 'token already consumed' };
      if (rec.expiresAt < clock()) return { ok: false, error: 'token expired' };
      // Constant-time compare of the bound email address.
      const a = Buffer.from(rec.emailAddress);
      const b = Buffer.from(emailAddress || '');
      if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, error: 'email does not match token' };
      rec.consumed = true;
      return { ok: true, emailAddress: rec.emailAddress };
    },
    get tokenCount() { return tokens.size; },
  };
}
