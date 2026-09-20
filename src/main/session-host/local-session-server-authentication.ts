import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { LOCAL_SESSION_PROFILE_NAME_MAX_LENGTH } from '@shared/types/local-session-profile'
import {
  deriveProfileCredentialServerKey,
  type ProfileCredentialServerChallenge,
  profileCredentialServerMaterialFromVerifier,
} from './profile-credential'

const AUTHENTICATION_NONCE_BYTES = 32
const BASE64URL_32_BYTE_PATTERN = /^[A-Za-z0-9_-]{43}$/
const SERVER_AUTHENTICATION_CONTEXT = 'openwaggle-local-session-server-v1'

export type LocalSessionServerAuthenticationRequest =
  | {
      readonly kind: 'server-authentication-request'
      readonly nonce: string
    }
  | {
      readonly kind: 'server-authentication-request'
      readonly nonce: string
      readonly profile: string
    }

export type LocalSessionServerAuthenticationResponse =
  | {
      readonly kind: 'server-authentication-response'
      readonly nonce: string
      readonly authority: 'local-user'
      readonly proof: string
    }
  | {
      readonly kind: 'server-authentication-response'
      readonly nonce: string
      readonly authority: 'profile'
      readonly profile: string
      readonly challenge: ProfileCredentialServerChallenge
      readonly proof: string
    }

export type LocalSessionServerAuthenticator = (
  value: unknown,
) => Promise<LocalSessionServerAuthenticationResponse>

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every((key) => actual.includes(key))
}

function decodeRequest(value: unknown): LocalSessionServerAuthenticationRequest {
  if (
    (!isExactRecord(value, ['kind', 'nonce']) &&
      !isExactRecord(value, ['kind', 'nonce', 'profile'])) ||
    value.kind !== 'server-authentication-request' ||
    typeof value.nonce !== 'string' ||
    !BASE64URL_32_BYTE_PATTERN.test(value.nonce) ||
    ('profile' in value &&
      (typeof value.profile !== 'string' ||
        value.profile.length === 0 ||
        value.profile.length > LOCAL_SESSION_PROFILE_NAME_MAX_LENGTH))
  ) {
    throw new Error('Invalid Local Session server-authentication request.')
  }
  return typeof value.profile === 'string'
    ? { kind: 'server-authentication-request', nonce: value.nonce, profile: value.profile }
    : { kind: 'server-authentication-request', nonce: value.nonce }
}

function proofFor(
  key: string | Buffer,
  input:
    | { readonly authority: 'local-user'; readonly nonce: string }
    | {
        readonly authority: 'profile'
        readonly nonce: string
        readonly profile: string
        readonly challenge: ProfileCredentialServerChallenge
      },
) {
  const hmac = createHmac('sha256', key)
    .update(SERVER_AUTHENTICATION_CONTEXT)
    .update('\0')
    .update(input.authority)
    .update('\0')
  if (input.authority === 'profile') {
    hmac.update(input.profile).update('\0').update(input.challenge.kind).update('\0')
    hmac.update(input.challenge.salt).update('\0')
  }
  return hmac.update(input.nonce).digest('base64url')
}

export function createLocalSessionServerAuthenticationRequest(
  profile?: string,
): LocalSessionServerAuthenticationRequest {
  if (profile !== undefined && profile.length === 0) {
    throw new Error('A Local Session profile name is required for server authentication.')
  }
  return {
    kind: 'server-authentication-request',
    nonce: randomBytes(AUTHENTICATION_NONCE_BYTES).toString('base64url'),
    ...(profile !== undefined ? { profile } : {}),
  }
}

export function createLocalSessionServerAuthenticationResponse(
  value: unknown,
  credential: string,
): LocalSessionServerAuthenticationResponse {
  const request = decodeRequest(value)
  if ('profile' in request) {
    throw new Error('A profile credential verifier is required for server authentication.')
  }
  return {
    kind: 'server-authentication-response',
    nonce: request.nonce,
    authority: 'local-user',
    proof: proofFor(credential, {
      authority: 'local-user',
      nonce: request.nonce,
    }),
  }
}

export function createLocalSessionServerAuthenticator(input: {
  readonly localUserCredential: string
  readonly resolveProfileCredentialVerifier: (profile: string) => Promise<string | null>
}): LocalSessionServerAuthenticator {
  return async (value) => {
    const request = decodeRequest(value)
    if (!('profile' in request)) {
      return createLocalSessionServerAuthenticationResponse(request, input.localUserCredential)
    }
    const verifier = await input.resolveProfileCredentialVerifier(request.profile)
    const material = verifier ? profileCredentialServerMaterialFromVerifier(verifier) : null
    if (!material) throw new Error('Local Session profile server authentication failed.')
    const responseInput = {
      authority: 'profile' as const,
      nonce: request.nonce,
      profile: request.profile,
      challenge: material.challenge,
    }
    return {
      kind: 'server-authentication-response',
      nonce: request.nonce,
      authority: 'profile',
      profile: request.profile,
      challenge: material.challenge,
      proof: proofFor(material.key, responseInput),
    }
  }
}

function identityVerificationFailed(): Error {
  return new Error('Local Session Host identity verification failed.')
}

function verifyProof(
  key: string | Buffer,
  proofInput: Parameters<typeof proofFor>[1],
  proof: string,
) {
  const expected = Buffer.from(proofFor(key, proofInput), 'base64url')
  const received = Buffer.from(proof, 'base64url')
  if (expected.byteLength !== received.byteLength || !timingSafeEqual(expected, received)) {
    throw identityVerificationFailed()
  }
}

function decodeProfileResponse(
  value: unknown,
  request: Extract<LocalSessionServerAuthenticationRequest, { readonly profile: string }>,
): {
  readonly challenge: ProfileCredentialServerChallenge
  readonly proof: string
} {
  if (
    !isExactRecord(value, ['kind', 'nonce', 'authority', 'profile', 'challenge', 'proof']) ||
    value.kind !== 'server-authentication-response' ||
    value.nonce !== request.nonce ||
    value.authority !== 'profile' ||
    value.profile !== request.profile ||
    !isExactRecord(value.challenge, ['kind', 'salt']) ||
    value.challenge.kind !== 'scrypt-v1' ||
    typeof value.challenge.salt !== 'string' ||
    typeof value.proof !== 'string' ||
    !BASE64URL_32_BYTE_PATTERN.test(value.proof)
  ) {
    throw identityVerificationFailed()
  }
  return {
    challenge: { kind: value.challenge.kind, salt: value.challenge.salt },
    proof: value.proof,
  }
}

function decodeLocalUserProof(value: unknown, request: { readonly nonce: string }) {
  if (
    !isExactRecord(value, ['kind', 'nonce', 'authority', 'proof']) ||
    value.kind !== 'server-authentication-response' ||
    value.nonce !== request.nonce ||
    value.authority !== 'local-user' ||
    typeof value.proof !== 'string' ||
    !BASE64URL_32_BYTE_PATTERN.test(value.proof)
  ) {
    throw identityVerificationFailed()
  }
  return value.proof
}

async function verifyProfileResponse(input: {
  readonly value: unknown
  readonly request: Extract<LocalSessionServerAuthenticationRequest, { readonly profile: string }>
  readonly credential: string
}): Promise<void> {
  const response = decodeProfileResponse(input.value, input.request)
  const key = await deriveProfileCredentialServerKey(input.credential, response.challenge).catch(
    () => null,
  )
  if (!key) throw identityVerificationFailed()
  verifyProof(
    key,
    {
      authority: 'profile',
      nonce: input.request.nonce,
      profile: input.request.profile,
      challenge: response.challenge,
    },
    response.proof,
  )
}

export async function verifyLocalSessionServerAuthenticationResponse(input: {
  readonly value: unknown
  readonly request: LocalSessionServerAuthenticationRequest
  readonly credential: string
}): Promise<void> {
  if ('profile' in input.request) {
    await verifyProfileResponse({
      value: input.value,
      request: input.request,
      credential: input.credential,
    })
  } else {
    verifyProof(
      input.credential,
      { authority: 'local-user', nonce: input.request.nonce },
      decodeLocalUserProof(input.value, input.request),
    )
  }
}
