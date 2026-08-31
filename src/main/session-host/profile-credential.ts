import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

const PROFILE_CREDENTIAL_BYTES = 32
const PROFILE_SALT_BYTES = 16
const PROFILE_DERIVED_KEY_BYTES = 32
const SCRYPT_COST = 32_768
const SCRYPT_BLOCK_SIZE = 8
const SCRYPT_PARALLELIZATION = 1
const SCRYPT_MAX_MEMORY_BYTES = 64 * 1024 * 1024
const VERIFIER_PREFIX = 'scrypt-v1'

export interface ProfileCredentialServerChallenge {
  readonly kind: 'scrypt-v1'
  readonly salt: string
}

interface ParsedProfileCredentialVerifier {
  readonly salt: Buffer
  readonly derivedKey: Buffer
}

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

function parseProfileCredentialVerifier(verifier: string): ParsedProfileCredentialVerifier | null {
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
    return null
  }
  try {
    const salt = Buffer.from(encodedSalt, 'base64url')
    const derivedKey = Buffer.from(encodedExpected, 'base64url')
    if (
      salt.byteLength !== PROFILE_SALT_BYTES ||
      derivedKey.byteLength !== PROFILE_DERIVED_KEY_BYTES
    ) {
      return null
    }
    return { salt, derivedKey }
  } catch {
    return null
  }
}

export function profileCredentialServerMaterialFromVerifier(verifier: string): {
  readonly challenge: ProfileCredentialServerChallenge
  readonly key: Buffer
} | null {
  const parsed = parseProfileCredentialVerifier(verifier)
  if (!parsed) return null
  return {
    challenge: {
      kind: VERIFIER_PREFIX,
      salt: parsed.salt.toString('base64url'),
    },
    key: parsed.derivedKey,
  }
}

export async function deriveProfileCredentialServerKey(
  credential: string,
  challenge: ProfileCredentialServerChallenge,
): Promise<Buffer> {
  if (challenge.kind !== VERIFIER_PREFIX) {
    throw new Error('Unsupported profile credential derivation.')
  }
  const salt = Buffer.from(challenge.salt, 'base64url')
  if (salt.byteLength !== PROFILE_SALT_BYTES) {
    throw new Error('Invalid profile credential derivation salt.')
  }
  return deriveCredential(credential, salt)
}

export async function verifyProfileCredential(
  credential: string,
  verifier: string,
): Promise<boolean> {
  const parsed = parseProfileCredentialVerifier(verifier)
  if (!parsed) return false
  try {
    const received = await deriveCredential(credential, parsed.salt)
    return timingSafeEqual(parsed.derivedKey, received)
  } catch {
    return false
  }
}
