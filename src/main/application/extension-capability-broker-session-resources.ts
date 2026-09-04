import { createHash, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { matchBy } from '@diegogbrisa/ts-match'
import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { safeDecodeUnknown } from '@shared/schema'
import {
  extensionSessionResourceListPayloadSchema,
  extensionSessionResourcePublishPayloadSchema,
} from '@shared/schemas/extension-broker-session-resources'
import { SessionId } from '@shared/types/brand'
import type {
  ExtensionInvokeInput,
  ExtensionSessionResourceCategory,
  ExtensionSessionResourceView,
} from '@shared/types/extension-broker'
import type { SessionResource } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import type { DiscoveredExtensionPackage } from '../extensions/types'
import { SessionRepository } from '../ports/session-repository'
import { SessionResourceRepository } from '../ports/session-resource-repository'
import { auditedFailure, auditedSuccess } from './extension-capability-broker-audit'
import { withSessionResourceInvalidation } from './session-resource-invalidation'

const DEFAULT_RESOURCE_LIST_LIMIT = 100

function sessionResourceView(resource: SessionResource): ExtensionSessionResourceView {
  return {
    resourceId: resource.id,
    kind: resource.kind,
    title: resource.title,
    mimeType: resource.mimeType,
    available: resource.available,
    source: resource.isSource,
    output: resource.isOutput,
    occurrences: resource.occurrences.map((occurrence) => ({
      actor: occurrence.actor,
      activity: occurrence.activity,
      label: occurrence.label,
      createdAt: occurrence.createdAt,
    })),
    createdAt: resource.createdAt,
    updatedAt: resource.updatedAt,
  }
}

function resourceMatchesCategory(
  resource: SessionResource,
  category: ExtensionSessionResourceCategory,
) {
  if (category === 'all') return true
  return category === 'sources' ? resource.isSource : resource.isOutput
}

function extensionResourceCanonicalKey(input: {
  readonly extensionId: string
  readonly contributionId: string
  readonly key: string
}) {
  const digest = createHash('sha256')
    .update(
      [input.extensionId, input.contributionId, input.key].join(
        OPENWAGGLE_EXTENSION.HASH.FIELD_SEPARATOR,
      ),
    )
    .digest('hex')
  return `extension:${input.extensionId}:${digest}`
}

function publishSessionResource(input: {
  readonly invocation: ExtensionInvokeInput
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly timestamp: number
}) {
  if (input.invocation.scope.kind !== 'session') {
    return auditedFailure({
      invocation: input.invocation,
      code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.OUT_OF_SCOPE,
      message: 'Session Resources require an opened Session scope.',
      timestamp: input.timestamp,
    })
  }
  const scope = input.invocation.scope

  const decoded = safeDecodeUnknown(
    extensionSessionResourcePublishPayloadSchema,
    input.invocation.payload,
  )
  if (!decoded.success) {
    return auditedFailure({
      invocation: input.invocation,
      code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.INVALID_PAYLOAD,
      message: 'Invalid Session Resource publication payload.',
      timestamp: input.timestamp,
      issues: decoded.issues,
    })
  }

  const sessionId = SessionId(input.invocation.scope.sessionId)
  const reference = decoded.data.reference
  const locator =
    reference === undefined
      ? null
      : matchBy(reference, 'kind')
          .with('external-url', (external) => external.url)
          .with('project-file', (projectFile) => resolve(scope.projectPath, projectFile.path))
          .exhaustive()

  return withSessionResourceInvalidation(
    sessionId,
    Effect.gen(function* () {
      const resources = yield* SessionResourceRepository
      const sessions = yield* SessionRepository
      const workspace = yield* sessions.getWorkspace(sessionId)
      const resource = yield* resources.upsert({
        id: randomUUID(),
        sessionId,
        canonicalKey: extensionResourceCanonicalKey({
          extensionId: input.invocation.extensionId,
          contributionId: input.invocation.contributionId,
          key: decoded.data.key,
        }),
        kind: decoded.data.kind,
        title: decoded.data.title,
        mimeType: decoded.data.mimeType ?? null,
        locator,
        managedPath: null,
        available: true,
        occurrence: {
          id: `extension:${randomUUID()}`,
          nodeId: workspace?.activeNodeId ? String(workspace.activeNodeId) : null,
          branchId: workspace?.activeBranchId ? String(workspace.activeBranchId) : null,
          actor: 'extension',
          activity: decoded.data.activity,
          label: decoded.data.label ?? input.extensionPackage.manifest?.name ?? null,
          createdAt: input.timestamp,
        },
        createdAt: input.timestamp,
        updatedAt: input.timestamp,
      })

      return yield* auditedSuccess({
        invocation: input.invocation,
        timestamp: input.timestamp,
        value: {
          extensionId: input.invocation.extensionId,
          contributionId: input.invocation.contributionId,
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SESSION_RESOURCES,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.PUBLISH_SESSION_RESOURCE,
          sessionId: scope.sessionId,
          resource: sessionResourceView(resource),
        },
      })
    }),
  ).pipe(
    Effect.catchAll(() =>
      auditedFailure({
        invocation: input.invocation,
        code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.TRANSPORT_FAILED,
        message: 'Session Resource publication failed.',
        timestamp: input.timestamp,
      }),
    ),
  )
}

function listSessionResources(input: {
  readonly invocation: ExtensionInvokeInput
  readonly timestamp: number
}) {
  if (input.invocation.scope.kind !== 'session') {
    return auditedFailure({
      invocation: input.invocation,
      code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.OUT_OF_SCOPE,
      message: 'Session Resources require an opened Session scope.',
      timestamp: input.timestamp,
    })
  }
  const scope = input.invocation.scope

  const decoded = safeDecodeUnknown(
    extensionSessionResourceListPayloadSchema,
    input.invocation.payload ?? {},
  )
  if (!decoded.success) {
    return auditedFailure({
      invocation: input.invocation,
      code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.INVALID_PAYLOAD,
      message: 'Invalid Session Resource list payload.',
      timestamp: input.timestamp,
      issues: decoded.issues,
    })
  }

  const category = decoded.data.category ?? 'all'
  const limit = decoded.data.limit ?? DEFAULT_RESOURCE_LIST_LIMIT
  const sessionId = SessionId(input.invocation.scope.sessionId)
  return Effect.gen(function* () {
    const repository = yield* SessionResourceRepository
    const resources = (yield* repository.list(sessionId)).filter((resource) =>
      resourceMatchesCategory(resource, category),
    )

    return yield* auditedSuccess({
      invocation: input.invocation,
      timestamp: input.timestamp,
      value: {
        extensionId: input.invocation.extensionId,
        contributionId: input.invocation.contributionId,
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SESSION_RESOURCES,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST_SESSION_RESOURCES,
        sessionId: scope.sessionId,
        category,
        total: resources.length,
        resources: resources.slice(0, limit).map(sessionResourceView),
      },
    })
  }).pipe(
    Effect.catchAll(() =>
      auditedFailure({
        invocation: input.invocation,
        code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.TRANSPORT_FAILED,
        message: 'Session Resource listing failed.',
        timestamp: input.timestamp,
      }),
    ),
  )
}

export function routeSessionResourceCapability(input: {
  readonly invocation: ExtensionInvokeInput
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly timestamp: number
}) {
  if (input.invocation.method === OPENWAGGLE_EXTENSION_BROKER.METHOD.PUBLISH_SESSION_RESOURCE) {
    return publishSessionResource(input)
  }
  if (input.invocation.method === OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST_SESSION_RESOURCES) {
    return listSessionResources(input)
  }

  return auditedFailure({
    invocation: input.invocation,
    code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.UNSUPPORTED_METHOD,
    message: `Method "${input.invocation.method}" is not implemented for capability "${input.invocation.capability}".`,
    timestamp: input.timestamp,
  })
}
