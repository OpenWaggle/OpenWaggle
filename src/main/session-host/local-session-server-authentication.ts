import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { decodeUnknownExactOrThrow, Schema } from '@shared/schema'
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

const proofSchema = Schema.String.pipe(Schema.pattern(BASE64URL_32_BYTE_PATTERN))

/** Exact keys: an undeclared member, or an explicitly undefined `profile`, is refused. */
const authenticationRequestSchema = Schema.Struct({
  kind: Schema.Literal('server-authentication-request'),
  nonce: proofSchema,
  profile: Schema.optionalWith(
    Schema.String.pipe(
      Schema.minLength(1),
      Schema.maxLength(LOCAL_SESSION_PROFILE_NAME_MAX_LENGTH),
    ),
    { exact: true },
  ),
})

const profileAuthenticationResponseSchema = Schema.Struct({
  kind: Schema.Literal('server-authentication-response'),
  nonce: Schema.String,
  authority: Schema.Literal('profile'),
  profile: Schema.String,
  challenge: Schema.Struct({ kind: Schema.Literal('scrypt-v1'), salt: Schema.String }),
  proof: proofSchema,
})

const localUserAuthenticationResponseSchema = Schema.Struct({
  kind: Schema.Literal('server-authentication-response'),
  nonce: Schema.String,
  authority: Schema.Literal('local-user'),
  proof: proofSchema,
})

/** The value decoded with exactly the schema's members, or `null`. */
function decodeExactly<A, I>(schema: Schema.Schema<A, I>, value: unknown) {
  try {
    const result: A | null = decodeUnknownExactOrThrow(schema, value)
    return result
  } catch {
    return null
  }
}

function decodeRequest(value: unknown) {
  const request = decodeExactly(authenticationRequestSchema, value)
  if (!request) throw new Error('Invalid Local Session server-authentication request.')
  const result: LocalSessionServerAuthenticationRequest =
    request.profile === undefined
      ? { kind: 'server-authentication-request', nonce: request.nonce }
      : { kind: 'server-authentication-request', nonce: request.nonce, profile: request.profile }
  return result
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

export function createLocalSessionServerAuthenticationRequest(profile?: string) {
  if (profile?.length === 0) {
    throw new Error('A Local Session profile name is required for server authentication.')
  }
  const request: LocalSessionServerAuthenticationRequest = {
    kind: 'server-authentication-request',
    nonce: randomBytes(AUTHENTICATION_NONCE_BYTES).toString('base64url'),
    ...(profile !== undefined ? { profile } : {}),
  }
  return request
}

export function createLocalSessionServerAuthenticationResponse(value: unknown, credential: string) {
  const request = decodeRequest(value)
  if ('profile' in request) {
    throw new Error('A profile credential verifier is required for server authentication.')
  }
  const response: LocalSessionServerAuthenticationResponse = {
    kind: 'server-authentication-response',
    nonce: request.nonce,
    authority: 'local-user',
    proof: proofFor(credential, {
      authority: 'local-user',
      nonce: request.nonce,
    }),
  }
  return response
}

export function createLocalSessionServerAuthenticator(input: {
  readonly localUserCredential: string
  readonly resolveProfileCredentialVerifier: (profile: string) => Promise<string | null>
}) {
  const authenticator: LocalSessionServerAuthenticator = async (value) => {
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
  return authenticator
}

function identityVerificationFailed() {
  const error: Error = new Error('Local Session Host identity verification failed.')
  return error
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
) {
  const response = decodeExactly(profileAuthenticationResponseSchema, value)
  if (!response || response.nonce !== request.nonce || response.profile !== request.profile) {
    throw identityVerificationFailed()
  }
  const result: {
    readonly challenge: ProfileCredentialServerChallenge
    readonly proof: string
  } = {
    challenge: { kind: response.challenge.kind, salt: response.challenge.salt },
    proof: response.proof,
  }
  return result
}

function decodeLocalUserProof(value: unknown, request: { readonly nonce: string }) {
  const response = decodeExactly(localUserAuthenticationResponseSchema, value)
  if (!response || response.nonce !== request.nonce) throw identityVerificationFailed()
  return response.proof
}

async function verifyProfileResponse(input: {
  readonly value: unknown
  readonly request: Extract<LocalSessionServerAuthenticationRequest, { readonly profile: string }>
  readonly credential: string
}) {
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
}) {
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
