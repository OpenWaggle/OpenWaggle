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
import { SessionResourceRepository } from '../ports/session-resource-repository'
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
    const normalizedResource = yield* repository.findByCanonicalKey(
      sessionId,
      normalizedCanonicalKey,
    )
    const legacyResource =
      normalizedResource || legacyCanonicalKey === normalizedCanonicalKey
        ? null
        : yield* repository.findByCanonicalKey(sessionId, legacyCanonicalKey)
    const existingResource = normalizedResource ?? legacyResource
    const identityLocator = legacyResource ? payload.locator : normalizedLocator
    const createdAt = input.timestamp
    const resourceId = existingResource?.id ?? randomUUID()
    const resource = yield* repository.upsert({
      id: resourceId,
      sessionId,
      canonicalKey: existingResource?.canonicalKey ?? normalizedCanonicalKey,
      kind: payload.kind,
      title: payload.title,
      mimeType: null,
      locator: normalizedLocator,
      managedPath: null,
      available: true,
      occurrence: {
        id: `extension:${sessionId}:${input.invocation.extensionId}:${input.invocation.contributionId}:${payload.key}:${payload.role}:${identityLocator}`,
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
    return yield* auditedSuccess({
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
