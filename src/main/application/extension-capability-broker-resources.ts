import { randomUUID } from 'node:crypto'
import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { safeDecodeUnknown } from '@shared/schema'
import {
  extensionSessionResourcePublishPayloadSchema,
  extensionSessionResourcesListPayloadSchema,
} from '@shared/schemas/extension-broker'
import { SessionId } from '@shared/types/brand'
import type {
  ExtensionSessionResourcePublishPayload,
  ExtensionSessionResourceView,
} from '@shared/types/extension-broker'
import type { SessionResource } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import { SessionRepository } from '../ports/session-repository'
import {
  SessionResourceRepository,
  type SessionResourceRepositoryShape,
} from '../ports/session-resource-repository'
import { broadcastToWindows } from '../utils/broadcast'
import { auditedFailure, auditedSuccess } from './extension-capability-broker-audit'
import type { BrokerRouteInput } from './extension-capability-broker-openwaggle-common'
import {
  payloadDecodeFailure,
  unsupportedMethod,
} from './extension-capability-broker-openwaggle-common'
import { unsupportedPayloadIssues } from './extension-capability-broker-payload'
import { withSessionResourceLock } from './session-resource-lock'

const PUBLISH_PAYLOAD_KEYS = new Set(['key', 'title', 'kind', 'role', 'locator'])
const LIST_PAYLOAD_KEYS = new Set(['cursor', 'limit'])
const EXTENSION_RESOURCE_PAGE_SIZE = 100

function sessionIdFromScope(input: BrokerRouteInput) {
  return input.invocation.scope.kind === 'session'
    ? SessionId(input.invocation.scope.sessionId)
    : null
}

function resourceView(resource: SessionResource): ExtensionSessionResourceView {
  return {
    id: resource.id,
    title: resource.title,
    kind: resource.kind,
    mimeType: resource.mimeType,
    available: resource.available,
    isSource: resource.isSource,
    isOutput: resource.isOutput,
  }
}

function publishedResourceResult(
  input: BrokerRouteInput,
  sessionId: SessionId,
  resource: SessionResource,
) {
  return auditedSuccess({
    invocation: input.invocation,
    timestamp: input.timestamp,
    value: {
      extensionId: input.invocation.extensionId,
      contributionId: input.invocation.contributionId,
      capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RESOURCES,
      method: OPENWAGGLE_EXTENSION_BROKER.METHOD.PUBLISH_RESOURCE,
      sessionId,
      resource: resourceView(resource),
    },
  })
}

function compatibleResourceKind(
  resource: SessionResource,
  kind: ExtensionSessionResourcePublishPayload['kind'],
) {
  return kind === 'image' ? resource.kind === 'image' : resource.kind !== 'image'
}

function findExistingResource(
  repository: SessionResourceRepositoryShape,
  sessionId: SessionId,
  normalizedCanonicalKey: string,
  legacyCanonicalKey: string,
  kind: ExtensionSessionResourcePublishPayload['kind'],
) {
  return Effect.gen(function* () {
    const normalized = yield* repository.findByCanonicalKey(sessionId, normalizedCanonicalKey)
    if (normalized && compatibleResourceKind(normalized, kind)) {
      return { _tag: 'Existing' as const, resource: normalized, legacy: false }
    }
    let blocked = normalized !== null
    if (legacyCanonicalKey !== normalizedCanonicalKey) {
      const legacy = yield* repository.findByCanonicalKey(sessionId, legacyCanonicalKey)
      if (legacy && compatibleResourceKind(legacy, kind)) {
        return { _tag: 'Existing' as const, resource: legacy, legacy: true }
      }
      blocked ||= legacy !== null
    }
    const canonicalPrefix = kind === 'image' ? 'image-url:' : 'url:'
    const normalizedLocator = normalizedCanonicalKey.slice(canonicalPrefix.length)
    const legacy = yield* repository.findByLocator(sessionId, kind, normalizedLocator)
    if (legacy) return { _tag: 'Existing' as const, resource: legacy, legacy: true }
    return blocked ? { _tag: 'Blocked' as const } : { _tag: 'Missing' as const }
  })
}

function findReplayResource(
  repository: SessionResourceRepositoryShape,
  sessionId: SessionId,
  occurrenceIds: readonly string[],
  existingResource: SessionResource | null,
  kind: ExtensionSessionResourcePublishPayload['kind'],
) {
  return Effect.gen(function* () {
    const captured = yield* repository.hasOccurrences(sessionId, occurrenceIds)
    for (const occurrenceId of occurrenceIds) {
      if (!captured.has(occurrenceId)) continue
      if (
        existingResource &&
        compatibleResourceKind(existingResource, kind) &&
        existingResource.occurrences.some((occurrence) => occurrence.id === occurrenceId)
      ) {
        return existingResource
      }
      const owner = yield* repository.findByOccurrence(sessionId, occurrenceId, 'all')
      if (owner && compatibleResourceKind(owner, kind)) return owner
    }
    return null
  })
}

function publicationOccurrenceId(
  input: BrokerRouteInput,
  sessionId: SessionId,
  payload: ExtensionSessionResourcePublishPayload,
  locator: string,
  includeKind: boolean,
) {
  const kind = includeKind ? `:${payload.kind}` : ''
  return `extension:${sessionId}:${input.invocation.extensionId}:${input.invocation.contributionId}:${payload.key}${kind}:${payload.role}:${locator}`
}

function publishPayload(input: BrokerRouteInput) {
  const unsupportedIssues = unsupportedPayloadIssues(input.invocation.payload, PUBLISH_PAYLOAD_KEYS)
  if (unsupportedIssues.length > 0) return { ok: false as const, issues: unsupportedIssues }
  const decoded = safeDecodeUnknown(
    extensionSessionResourcePublishPayloadSchema,
    input.invocation.payload,
  )
  return decoded.success
    ? { ok: true as const, payload: decoded.data }
    : { ok: false as const, issues: decoded.issues }
}

function listPayload(input: BrokerRouteInput) {
  const unsupportedIssues = unsupportedPayloadIssues(input.invocation.payload, LIST_PAYLOAD_KEYS)
  if (unsupportedIssues.length > 0) return { ok: false as const, issues: unsupportedIssues }
  const decoded = safeDecodeUnknown(
    extensionSessionResourcesListPayloadSchema,
    input.invocation.payload,
  )
  return decoded.success
    ? { ok: true as const, payload: decoded.data }
    : { ok: false as const, issues: decoded.issues }
}

function joinedResourceMetadata(
  existingResource: SessionResource | null,
  payload: ExtensionSessionResourcePublishPayload,
) {
  if (existingResource) {
    return {
      kind: existingResource.kind,
      title: existingResource.title,
      available: existingResource.available,
    }
  }
  return { kind: payload.kind, title: payload.title, available: true }
}

function publishResource(
  input: BrokerRouteInput,
  sessionId: SessionId,
  payload: ExtensionSessionResourcePublishPayload,
) {
  return withSessionResourceLock(
    sessionId,
    Effect.gen(function* () {
      const repository = yield* SessionResourceRepository
      const sessions = yield* SessionRepository
      const workspace = yield* sessions.getWorkspace(sessionId)
      const normalizedLocator = new URL(payload.locator).href
      const canonicalPrefix = payload.kind === 'image' ? 'image-url:' : 'url:'
      const normalizedCanonicalKey = `${canonicalPrefix}${normalizedLocator}`
      const legacyCanonicalKey = `${canonicalPrefix}${payload.locator}`
      const existing = yield* findExistingResource(
        repository,
        sessionId,
        normalizedCanonicalKey,
        legacyCanonicalKey,
        payload.kind,
      )
      if (existing._tag === 'Blocked') {
        return yield* auditedFailure({
          invocation: input.invocation,
          code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.TRANSPORT_FAILED,
          message: 'The resource URL is occupied by an incompatible legacy resource.',
          timestamp: input.timestamp,
        })
      }
      const existingResource = existing._tag === 'Existing' ? existing.resource : null
      const occurrenceId = publicationOccurrenceId(
        input,
        sessionId,
        payload,
        normalizedLocator,
        true,
      )
      const occurrenceIds = [
        occurrenceId,
        publicationOccurrenceId(input, sessionId, payload, payload.locator, true),
        publicationOccurrenceId(input, sessionId, payload, normalizedLocator, false),
        publicationOccurrenceId(input, sessionId, payload, payload.locator, false),
      ].filter((candidate, index, candidates) => candidates.indexOf(candidate) === index)
      const replayResource = yield* findReplayResource(
        repository,
        sessionId,
        occurrenceIds,
        existingResource,
        payload.kind,
      )
      if (replayResource) return yield* publishedResourceResult(input, sessionId, replayResource)
      const metadata = joinedResourceMetadata(existingResource, payload)
      const createdAt = input.timestamp
      const resourceId = randomUUID()
      const resource = yield* repository.upsert({
        id: resourceId,
        sessionId,
        canonicalKey: existingResource?.canonicalKey ?? normalizedCanonicalKey,
        kind: metadata.kind,
        title: metadata.title,
        mimeType: null,
        locator: normalizedLocator,
        managedPath: null,
        available: metadata.available,
        occurrence: {
          id: occurrenceId,
          nodeId: workspace?.activeNodeId ? String(workspace.activeNodeId) : null,
          branchId: workspace?.activeBranchId ? String(workspace.activeBranchId) : null,
          actor: 'extension',
          activity: payload.role === 'output' ? 'created' : 'read',
          label: input.invocation.contributionId,
          locator: normalizedLocator,
          createdAt,
        },
        createdAt,
        updatedAt: createdAt,
      })
      broadcastToWindows('sessions:resources-invalidated', { sessionId })
      return yield* publishedResourceResult(input, sessionId, resource)
    }),
  )
}

export function routeSessionResourceCapability(input: BrokerRouteInput) {
  const sessionId = sessionIdFromScope(input)
  if (!sessionId) {
    return auditedFailure({
      invocation: input.invocation,
      code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.OUT_OF_SCOPE,
      message: 'Session resources require an explicit session scope.',
      timestamp: input.timestamp,
    })
  }

  if (input.invocation.method === OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST_RESOURCES) {
    const decoded = listPayload(input)
    if (!decoded.ok) return payloadDecodeFailure(input, decoded.issues)
    return Effect.gen(function* () {
      const repository = yield* SessionResourceRepository
      const page = yield* repository.listPage(sessionId, {
        view: 'all',
        cursor: decoded.payload.cursor ?? null,
        limit: decoded.payload.limit ?? EXTENSION_RESOURCE_PAGE_SIZE,
      })
      return yield* auditedSuccess({
        invocation: input.invocation,
        timestamp: input.timestamp,
        value: {
          extensionId: input.invocation.extensionId,
          contributionId: input.invocation.contributionId,
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RESOURCES,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST_RESOURCES,
          sessionId,
          resources: page.resources.map((resource) => resourceView(resource)),
          total: page.total,
          nextCursor: page.nextCursor,
        },
      })
    })
  }

  if (input.invocation.method === OPENWAGGLE_EXTENSION_BROKER.METHOD.PUBLISH_RESOURCE) {
    const decoded = publishPayload(input)
    return decoded.ok
      ? publishResource(input, sessionId, decoded.payload)
      : payloadDecodeFailure(input, decoded.issues)
  }

  return unsupportedMethod(input)
}
