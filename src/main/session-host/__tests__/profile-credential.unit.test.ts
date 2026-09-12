import { describe, expect, it } from 'vitest'
import {
  createProfileCredentialVerifier,
  generateProfileCredential,
  verifyProfileCredential,
} from '../profile-credential'

describe('restricted CLI profile credentials', () => {
  it('generates a 256-bit bearer credential and stores only a salted verifier', async () => {
    const credential = generateProfileCredential()
    const verifier = await createProfileCredentialVerifier(credential)

    expect(Buffer.from(credential, 'base64url')).toHaveLength(32)
    expect(verifier).not.toContain(credential)
    await expect(verifyProfileCredential(credential, verifier)).resolves.toBe(true)
    await expect(verifyProfileCredential(generateProfileCredential(), verifier)).resolves.toBe(
      false,
    )
  })

  it('rejects malformed or parameter-substituted verifiers without running attacker-selected work', async () => {
    const credential = generateProfileCredential()
    const verifier = await createProfileCredentialVerifier(credential)

    await expect(verifyProfileCredential(credential, 'malformed')).resolves.toBe(false)
    await expect(
      verifyProfileCredential(credential, verifier.replace('$32768$', '$1048576$')),
    ).resolves.toBe(false)
  })
})
