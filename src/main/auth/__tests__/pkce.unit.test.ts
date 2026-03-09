import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { generateCodeChallenge, generateCodeVerifier } from '../pkce'

describe('PKCE', () => {
  describe('generateCodeVerifier', () => {
    it('generates a base64url-encoded string', () => {
      const verifier = generateCodeVerifier()
      expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
    })

    it('generates a string of expected length (43 chars for 32 bytes)', () => {
      const verifier = generateCodeVerifier()
      expect(verifier.length).toBe(43)
    })

    it('generates unique verifiers on each call', () => {
      const a = generateCodeVerifier()
      const b = generateCodeVerifier()
      expect(a).not.toBe(b)
    })
  })

  describe('generateCodeChallenge', () => {
    it('generates a base64url-encoded SHA-256 hash', () => {
      const verifier = 'test-verifier'
      const challenge = generateCodeChallenge(verifier)
      expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/)
    })

    it('produces the correct S256 challenge for a known verifier', () => {
      const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
      const challenge = generateCodeChallenge(verifier)

      // Manually compute expected challenge
      const expected = createHash('sha256').update(verifier).digest('base64url')
      expect(challenge).toBe(expected)
    })

    it('produces different challenges for different verifiers', () => {
      const a = generateCodeChallenge('verifier-a')
      const b = generateCodeChallenge('verifier-b')
      expect(a).not.toBe(b)
    })
  })
})
