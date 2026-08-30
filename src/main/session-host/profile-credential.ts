import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

const PROFILE_CREDENTIAL_BYTES = 32
const PROFILE_SALT_BYTES = 16
const PROFILE_DERIVED_KEY_BYTES = 32
const SCRYPT_COST = 32_768
const SCRYPT_BLOCK_SIZE = 8
const SCRYPT_PARALLELIZATION = 1
const SCRYPT_MAX_MEMORY_BYTES = 64 * 1024 * 1024
const VERIFIER_PREFIX = 'scrypt-v1'

function deriveCredential(credential: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      credential,
      salt,
      PROFILE_DERIVED_KEY_BYTES,
      {
        N: SCRYPT_COST,
        r: SCRYPT_BLOCK_SIZE,
        p: SCRYPT_PARALLELIZATION,
        maxmem: SCRYPT_MAX_MEMORY_BYTES,
      },
      (error, derivedKey) => {
        if (error) reject(error)
        else resolve(derivedKey)
      },
    )
  })
}

export function generateProfileCredential(): string {
  return randomBytes(PROFILE_CREDENTIAL_BYTES).toString('base64url')
}

export async function createProfileCredentialVerifier(credential: string): Promise<string> {
  const salt = randomBytes(PROFILE_SALT_BYTES)
  const derived = await deriveCredential(credential, salt)
  return [
    VERIFIER_PREFIX,
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELIZATION,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$')
}

export async function verifyProfileCredential(
  credential: string,
  verifier: string,
): Promise<boolean> {
  const [prefix, cost, blockSize, parallelization, encodedSalt, encodedExpected, extra] =
    verifier.split('$')
  if (
    prefix !== VERIFIER_PREFIX ||
    cost !== String(SCRYPT_COST) ||
    blockSize !== String(SCRYPT_BLOCK_SIZE) ||
    parallelization !== String(SCRYPT_PARALLELIZATION) ||
    !encodedSalt ||
    !encodedExpected ||
    extra !== undefined
  ) {
    return false
  }
  try {
    const salt = Buffer.from(encodedSalt, 'base64url')
    const expected = Buffer.from(encodedExpected, 'base64url')
    if (
      salt.byteLength !== PROFILE_SALT_BYTES ||
      expected.byteLength !== PROFILE_DERIVED_KEY_BYTES
    ) {
      return false
    }
    const received = await deriveCredential(credential, salt)
    return timingSafeEqual(expected, received)
  } catch {
    return false
  }
}
