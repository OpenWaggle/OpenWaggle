import { randomUUID } from 'node:crypto'
import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { safeDecodeUnknown } from '@shared/schema'
import { extensionSessionResourcePublishPayloadSchema } from '@shared/schemas/extension-broker'
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
  invalidPayload,
  payloadDecodeFailure,
  unsupportedMethod,
} from './extension-capability-broker-openwaggle-common'
import { emptyObjectPayload, unsupportedPayloadIssues } from './extension-capability-broker-payload'

const PUBLISH_PAYLOAD_KEYS = new Set(['key', 'title', 'kind', 'role', 'locator'])

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

function findExistingResource(
  repository: SessionResourceRepositoryShape,
  sessionId: SessionId,
  normalizedCanonicalKey: string,
  legacyCanonicalKey: string,
) {
  return Effect.gen(function* () {
    const normalized = yield* repository.findByCanonicalKey(sessionId, normalizedCanonicalKey)
    if (normalized) return { resource: normalized, legacy: false }
    if (legacyCanonicalKey !== normalizedCanonicalKey) {
      const legacy = yield* repository.findByCanonicalKey(sessionId, legacyCanonicalKey)
      if (legacy) return { resource: legacy, legacy: true }
    }
    const normalizedLocator = normalizedCanonicalKey.slice('url:'.length)
    const legacy = (yield* repository.list(sessionId)).find((candidate) => {
      if (!candidate.canonicalKey.startsWith('url:')) return false
      try {
        return new URL(candidate.canonicalKey.slice('url:'.length)).href === normalizedLocator
      } catch {
        return false
      }
    })
    return { resource: legacy ?? null, legacy: legacy !== undefined }
  })
}

function findReplayResource(
  repository: SessionResourceRepositoryShape,
  sessionId: SessionId,
  occurrenceId: string,
  existingResource: SessionResource | null,
) {
  return Effect.gen(function* () {
    if (!(yield* repository.hasOccurrence(sessionId, occurrenceId))) return null
    if (existingResource) return existingResource
    return (
      (yield* repository.list(sessionId)).find((candidate) =>
        candidate.occurrences.some((occurrence) => occurrence.id === occurrenceId),
      ) ?? null
    )
  })
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
  return Effect.gen(function* () {
    const repository = yield* SessionResourceRepository
    const sessions = yield* SessionRepository
    const workspace = yield* sessions.getWorkspace(sessionId)
    const normalizedLocator = new URL(payload.locator).href
    const normalizedCanonicalKey = `url:${normalizedLocator}`
    const legacyCanonicalKey = `url:${payload.locator}`
    const existing = yield* findExistingResource(
      repository,
      sessionId,
      normalizedCanonicalKey,
      legacyCanonicalKey,
    )
    const existingResource = existing.resource
    const identityLocator = existing.legacy ? payload.locator : normalizedLocator
    const occurrenceId = `extension:${sessionId}:${input.invocation.extensionId}:${input.invocation.contributionId}:${payload.key}:${payload.role}:${identityLocator}`
    const replayResource = yield* findReplayResource(
      repository,
      sessionId,
      occurrenceId,
      existingResource,
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
        createdAt,
      },
      createdAt,
      updatedAt: createdAt,
    })
    broadcastToWindows('sessions:resources-invalidated', { sessionId })
    return yield* publishedResourceResult(input, sessionId, resource)
  })
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
    if (!emptyObjectPayload(input.invocation.payload)) return invalidPayload(input)
    return Effect.gen(function* () {
      const repository = yield* SessionResourceRepository
      const resources = yield* repository.list(sessionId)
      return yield* auditedSuccess({
        invocation: input.invocation,
        timestamp: input.timestamp,
        value: {
          extensionId: input.invocation.extensionId,
          contributionId: input.invocation.contributionId,
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RESOURCES,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST_RESOURCES,
          sessionId,
          resources: resources.map((resource) => resourceView(resource)),
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
