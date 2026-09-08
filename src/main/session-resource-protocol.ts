import { randomUUID } from 'node:crypto'
import { SESSION_RESOURCE_PROTOCOL } from '@shared/constants/session-resource-protocol'
import type { SessionId } from '@shared/types/brand'
import type { SessionResourceContent } from '@shared/types/session-resource'
import { protocol } from 'electron'
import { isTrustedRendererRequest } from './renderer-request-trust'
import { downloadContentDisposition } from './session-resource-content-disposition'

const HTTP_NOT_FOUND_STATUS = 404
const DEFAULT_REGISTRATION_TTL_MS = 60 * 60 * 1_000
const DEFAULT_MAX_REGISTRATIONS_PER_OWNER = 64
const MAX_TOKEN_GENERATION_ATTEMPTS = 8
const REQUEST_PATH_SEGMENT_COUNT = 2
const ASCII_CONTROL_MAX = 0x1f
const ASCII_DELETE = 0x7f
const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const MIME_TYPE_PATTERN =
  /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*(?:\s*;\s*[a-z0-9!#$&^_.+-]+=(?:[a-z0-9!#$&^_.+-]+|"[^"]*"))*$/iu
const DEFAULT_MIME_TYPE = 'application/octet-stream'

interface RegisteredSessionResourceContent {
  readonly controller: AbortController
  readonly ownerId: number
  readonly resourceId: string
  readonly sessionId: SessionId
  readonly expiresAt: number
  readonly registeredAt: number
}

interface SessionResourceProtocolContent {
  readonly fileName: string
  readonly mimeType: string
  readonly body: ReadableStream<Uint8Array>
}

interface SessionResourceProtocolDependencies {
  readonly readContent?: (input: {
    readonly sessionId: SessionId
    readonly resourceId: string
  }) => Promise<SessionResourceProtocolContent | null>
  readonly createToken?: () => string
  readonly now?: () => number
  readonly registrationTtlMs?: number
  readonly maxRegistrationsPerOwner?: number
  readonly isTrustedRequest?: (referrer: string) => boolean
}

const registrations = new Map<string, RegisteredSessionResourceContent>()
let protocolRegistered = false
let createToken: () => string = randomUUID
let currentTime = Date.now
let registrationTtlMs = DEFAULT_REGISTRATION_TTL_MS
let maxRegistrationsPerOwner = DEFAULT_MAX_REGISTRATIONS_PER_OWNER
let isTrustedRequest = isTrustedRendererRequest

function unregisterToken(token: string) {
  registrations.get(token)?.controller.abort()
  registrations.delete(token)
}

function purgeExpiredRegistrations(now: number) {
  for (const [token, registration] of registrations) {
    if (registration.expiresAt <= now) unregisterToken(token)
  }
}

function enforceOwnerRegistrationLimit(ownerId: number) {
  const owned = [...registrations.entries()]
    .filter(([, registration]) => registration.ownerId === ownerId)
    .sort((left, right) => left[1].registeredAt - right[1].registeredAt)
  const excess = owned.length - maxRegistrationsPerOwner
  if (excess <= 0) return
  for (const [token] of owned.slice(0, excess)) unregisterToken(token)
}

function freshToken() {
  for (let attempt = 0; attempt < MAX_TOKEN_GENERATION_ATTEMPTS; attempt += 1) {
    const token = createToken()
    if (TOKEN_PATTERN.test(token) && !registrations.has(token)) return token
  }
  throw new Error('Could not create a unique Session resource capability.')
}

function contentUrl(token: string, action: string) {
  return `${SESSION_RESOURCE_PROTOCOL.SCHEME}://${SESSION_RESOURCE_PROTOCOL.HOST}/${token}/${action}`
}

export function registerSessionResourceContentReference(
  input: {
    readonly sessionId: SessionId
    readonly resourceId: string
    readonly fileName: string
    readonly mimeType: string
  },
  ownerId: number,
): SessionResourceContent {
  const now = currentTime()
  if (!Number.isSafeInteger(ownerId) || ownerId < 0) {
    throw new Error('Invalid Session resource capability owner.')
  }
  purgeExpiredRegistrations(now)
  for (const [token, registration] of registrations) {
    if (
      registration.ownerId === ownerId &&
      (registration.sessionId !== input.sessionId || registration.resourceId === input.resourceId)
    ) {
      unregisterToken(token)
    }
  }
  const token = freshToken()
  registrations.set(token, {
    controller: new AbortController(),
    ownerId,
    sessionId: input.sessionId,
    resourceId: input.resourceId,
    expiresAt: now + registrationTtlMs,
    registeredAt: now,
  })
  enforceOwnerRegistrationLimit(ownerId)
  return {
    resourceId: input.resourceId,
    fileName: input.fileName,
    mimeType: input.mimeType,
    url: contentUrl(token, SESSION_RESOURCE_PROTOCOL.VIEW_PATH),
    downloadUrl: contentUrl(token, SESSION_RESOURCE_PROTOCOL.DOWNLOAD_PATH),
  }
}

async function cancelContentBody(body: ReadableStream<Uint8Array>, reason: unknown) {
  await body.cancel(reason).catch(() => undefined)
}

function revocableContentBody(body: ReadableStream<Uint8Array>, signal: AbortSignal) {
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>(), { signal })
}

export function unregisterSessionResourceContentReferencesForOwner(ownerId: number) {
  for (const [token, registration] of registrations) {
    if (registration.ownerId === ownerId) unregisterToken(token)
  }
}

function parseRequest(requestUrl: string) {
  const url = new URL(requestUrl)
  const segments = url.pathname.split('/').filter(Boolean)
  const token = segments[0]
  const action = segments[1]
  if (
    url.protocol !== `${SESSION_RESOURCE_PROTOCOL.SCHEME}:` ||
    url.host !== SESSION_RESOURCE_PROTOCOL.HOST ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.port.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0 ||
    segments.length !== REQUEST_PATH_SEGMENT_COUNT ||
    !token ||
    !TOKEN_PATTERN.test(token) ||
    (action !== SESSION_RESOURCE_PROTOCOL.VIEW_PATH &&
      action !== SESSION_RESOURCE_PROTOCOL.DOWNLOAD_PATH)
  ) {
    return null
  }
  return { action, token }
}

function notFoundResponse() {
  return new Response(null, { status: HTTP_NOT_FOUND_STATUS })
}

/** Authenticate custom-scheme requests using Electron's frame identity, not HTTP referrers. */
export function shouldBlockSessionResourceRequest(input: {
  readonly url: string
  readonly ownerId: number | undefined
  readonly frameUrl: string | undefined
  readonly isMainFrame: boolean
}) {
  if (!input.url.startsWith(`${SESSION_RESOURCE_PROTOCOL.SCHEME}:`)) return false
  try {
    const target = parseRequest(input.url)
    const registration = target ? registrations.get(target.token) : undefined
    return (
      !registration ||
      registration.ownerId !== input.ownerId ||
      registration.expiresAt <= currentTime() ||
      !input.isMainFrame ||
      !input.frameUrl ||
      !isTrustedRequest(input.frameUrl)
    )
  } catch {
    return true
  }
}

export function isSessionResourceDownloadNavigation(
  url: string,
  ownerId: number,
  frameUrl: string,
) {
  if (shouldBlockSessionResourceRequest({ url, ownerId, frameUrl, isMainFrame: true })) return false
  try {
    return parseRequest(url)?.action === SESSION_RESOURCE_PROTOCOL.DOWNLOAD_PATH
  } catch {
    return false
  }
}

function safeMimeType(mimeType: string) {
  const hasControlCharacter = [...mimeType].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= ASCII_CONTROL_MAX || codePoint === ASCII_DELETE
  })
  return !hasControlCharacter && MIME_TYPE_PATTERN.test(mimeType)
    ? mimeType.toLowerCase()
    : DEFAULT_MIME_TYPE
}

async function defaultReadContent(input: {
  readonly sessionId: SessionId
  readonly resourceId: string
}): Promise<SessionResourceProtocolContent | null> {
  const [{ openSessionResourceContentStream }, { runAppEffect }] = await Promise.all([
    import('./application/session-resource-content'),
    import('./runtime'),
  ])
  return runAppEffect(openSessionResourceContentStream(input.sessionId, input.resourceId))
}

export function registerSessionResourceProtocolOnce(
  dependencies: SessionResourceProtocolDependencies = {},
) {
  if (protocolRegistered) return
  protocolRegistered = true
  createToken = dependencies.createToken ?? randomUUID
  currentTime = dependencies.now ?? Date.now
  registrationTtlMs = dependencies.registrationTtlMs ?? DEFAULT_REGISTRATION_TTL_MS
  maxRegistrationsPerOwner =
    dependencies.maxRegistrationsPerOwner ?? DEFAULT_MAX_REGISTRATIONS_PER_OWNER
  isTrustedRequest = dependencies.isTrustedRequest ?? isTrustedRendererRequest
  const readContent = dependencies.readContent ?? defaultReadContent
  protocol.handle(SESSION_RESOURCE_PROTOCOL.SCHEME, async (request) => {
    try {
      if (request.method !== 'GET') return notFoundResponse()
      // Chromium omits referrers for custom schemes. The webRequest guard verifies the
      // requesting main frame and capability owner before this handler receives the request.
      if (request.referrer && !isTrustedRequest(request.referrer)) return notFoundResponse()
      const target = parseRequest(request.url)
      if (!target) return notFoundResponse()
      const registration = registrations.get(target.token)
      if (!registration) return notFoundResponse()
      if (registration.expiresAt <= currentTime()) {
        unregisterToken(target.token)
        return notFoundResponse()
      }
      const content = await readContent({
        sessionId: registration.sessionId,
        resourceId: registration.resourceId,
      })
      if (!content) return notFoundResponse()
      if (
        registration.controller.signal.aborted ||
        registrations.get(target.token) !== registration
      ) {
        await cancelContentBody(
          content.body,
          new Error('The Session resource capability was revoked while its content was opening.'),
        )
        return notFoundResponse()
      }
      return new Response(revocableContentBody(content.body, registration.controller.signal), {
        headers: {
          'content-type': safeMimeType(content.mimeType),
          'content-disposition':
            target.action === SESSION_RESOURCE_PROTOCOL.DOWNLOAD_PATH
              ? downloadContentDisposition(content.fileName)
              : 'inline',
          'cache-control': 'no-store',
          'referrer-policy': 'no-referrer',
          'x-content-type-options': 'nosniff',
        },
      })
    } catch {
      return notFoundResponse()
    }
  })
}
