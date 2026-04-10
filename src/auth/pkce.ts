/**
 * PKCE (Proof Key for Code Exchange) utilities.
 *
 * Generates a code_verifier and code_challenge for the OAuth 2.0
 * authorization code flow with PKCE, per RFC 7636.
 */

/**
 * Generate a random code_verifier string (43–128 chars, URL-safe).
 * Uses crypto.getRandomValues for cryptographic randomness.
 */
export function generateCodeVerifier(length = 64): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

/**
 * Derive the code_challenge from a code_verifier using SHA-256.
 * Returns a base64url-encoded hash.
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

/**
 * Base64url encoding (RFC 4648 §5) — no padding, URL-safe alphabet.
 */
function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
