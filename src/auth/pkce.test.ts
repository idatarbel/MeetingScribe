import { generateCodeVerifier, generateCodeChallenge } from './pkce';

describe('PKCE utilities', () => {
  describe('generateCodeVerifier', () => {
    it('generates a string of expected length', () => {
      const verifier = generateCodeVerifier(64);
      // Base64url encoding of 64 bytes = ~86 chars (no padding)
      expect(verifier.length).toBeGreaterThanOrEqual(43);
      expect(verifier.length).toBeLessThanOrEqual(128);
    });

    it('generates URL-safe characters only', () => {
      const verifier = generateCodeVerifier();
      // RFC 7636: unreserved characters = [A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~"
      // Base64url uses [A-Za-z0-9_-] which is a subset.
      expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('generates unique values on each call', () => {
      const a = generateCodeVerifier();
      const b = generateCodeVerifier();
      expect(a).not.toBe(b);
    });
  });

  describe('generateCodeChallenge', () => {
    it('produces a base64url-encoded SHA-256 hash', async () => {
      const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
      const challenge = await generateCodeChallenge(verifier);

      // Known SHA-256 of the above verifier (from RFC 7636 Appendix B):
      expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    });

    it('generates URL-safe characters only', async () => {
      const challenge = await generateCodeChallenge(generateCodeVerifier());
      expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    });
  });
});
