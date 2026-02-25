import { createHash, randomBytes } from 'node:crypto'

/**
 * Generate a PKCE code verifier (43-128 chars, base64url-encoded random bytes).
 */
export function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Generate a PKCE S256 code challenge from a verifier.
 */
export function generateCodeChallenge(verifier: string): string {
  const hash = createHash('sha256').update(verifier).digest()
  return hash.toString('base64url')
}
