import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { safeDecodeUnknown } from '@shared/schema'
import {
  extensionDocsDiscoverPayloadSchema,
  extensionDocsResolveTopicPayloadSchema,
} from '@shared/schemas/extension-broker-docs'
import type {
  ExtensionDocsDiscoverPayload,
  ExtensionInvokeInput,
} from '@shared/types/extension-broker'
import * as Effect from 'effect/Effect'
import { validateRequiredProjectPath } from '../utils/project-path-validation'
import { listDocsDiscoveryView, resolveDocsTopic } from './docs-discovery-service'
import { auditedFailure, auditedSuccess } from './extension-capability-broker-audit'
import { getScopeProjectPath } from './extension-capability-broker-model'
import { unsupportedPayloadIssues } from './extension-capability-broker-payload'

const DOCS_DISCOVER_KEYS = new Set(['projectPaths', 'includeExtensions'])
const DOCS_RESOLVE_TOPIC_KEYS = new Set(['topic'])

interface BrokerDocsRouteInput {
  readonly invocation: ExtensionInvokeInput
  readonly timestamp: number
}

type DocsListPayloadValidation =
  | { readonly _tag: 'valid'; readonly payload: ExtensionDocsDiscoverPayload }
  | { readonly _tag: 'invalid'; readonly issues: readonly string[] }
  | {
      readonly _tag: 'out-of-scope'
      readonly allowedProjectPath: string
      readonly projectPath: string
    }

function invalidPayload(input: BrokerDocsRouteInput & { readonly issues?: readonly string[] }) {
  return auditedFailure({
    invocation: input.invocation,
    code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.INVALID_PAYLOAD,
    message: `Invalid payload for ${input.invocation.capability}.${input.invocation.method}.`,
    ...(input.issues !== undefined ? { issues: input.issues } : {}),
    timestamp: input.timestamp,
  })
}

function unsupportedMethod(input: BrokerDocsRouteInput) {
  return auditedFailure({
    invocation: input.invocation,
    code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.UNSUPPORTED_METHOD,
    message: `Method "${input.invocation.method}" is not implemented for capability "${input.invocation.capability}".`,
    timestamp: input.timestamp,
  })
}

function outOfScopeProjectPath(
  input: BrokerDocsRouteInput & {
    readonly allowedProjectPath: string
    readonly projectPath: string
  },
) {
  return auditedFailure({
    invocation: input.invocation,
    code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.OUT_OF_SCOPE,
    message: `Project "${input.projectPath}" is outside the invocation project scope "${input.allowedProjectPath}".`,
    timestamp: input.timestamp,
  })
}

function payloadDecodeFailure(input: BrokerDocsRouteInput, issues: readonly string[]) {
  return invalidPayload({ ...input, issues })
}

function docsDiscoverPayload(input: BrokerDocsRouteInput) {
  const unsupportedIssues = unsupportedPayloadIssues(input.invocation.payload, DOCS_DISCOVER_KEYS)
  if (unsupportedIssues.length > 0) {
    return { ok: false as const, issues: unsupportedIssues }
  }

  const decoded = safeDecodeUnknown(
    extensionDocsDiscoverPayloadSchema,
    input.invocation.payload ?? {},
  )
  return decoded.success
    ? { ok: true as const, payload: decoded.data }
    : { ok: false as const, issues: decoded.issues }
}

function docsResolveTopicPayload(input: BrokerDocsRouteInput) {
  const unsupportedIssues = unsupportedPayloadIssues(
    input.invocation.payload,
    DOCS_RESOLVE_TOPIC_KEYS,
  )
  if (unsupportedIssues.length > 0) {
    return { ok: false as const, issues: unsupportedIssues }
  }

  const decoded = safeDecodeUnknown(
    extensionDocsResolveTopicPayloadSchema,
    input.invocation.payload,
  )
  return decoded.success
    ? { ok: true as const, payload: decoded.data }
    : { ok: false as const, issues: decoded.issues }
}

function validateDocsListProjectPaths(projectPaths: readonly string[]) {
  return Effect.gen(function* () {
    const validatedProjectPaths: string[] = []
    const seenProjectPaths = new Set<string>()
    for (const projectPath of projectPaths) {
      const validatedProjectPath = yield* validateRequiredProjectPath(projectPath)
      if (!seenProjectPaths.has(validatedProjectPath)) {
        seenProjectPaths.add(validatedProjectPath)
        validatedProjectPaths.push(validatedProjectPath)
      }
    }
    return validatedProjectPaths
  })
}

function normalizeDocsListProjectPaths(
  input: BrokerDocsRouteInput,
  projectPaths: readonly string[] | undefined,
): Effect.Effect<DocsListPayloadValidation> {
  const scopeProjectPath = getScopeProjectPath(input.invocation.scope)
  if (projectPaths === undefined && scopeProjectPath === undefined) {
    return Effect.succeed({ _tag: 'valid', payload: {} })
  }

  const requestedProjectPaths = projectPaths ?? (scopeProjectPath ? [scopeProjectPath] : [])

  return validateDocsListProjectPaths(requestedProjectPaths).pipe(
    Effect.flatMap((validatedProjectPaths) =>
      scopeProjectPath
        ? validateRequiredProjectPath(scopeProjectPath).pipe(
            Effect.map((allowedProjectPath): DocsListPayloadValidation => {
              const outOfScopeRequestedProjectPath = validatedProjectPaths.find(
                (projectPath) => projectPath !== allowedProjectPath,
              )
              return outOfScopeRequestedProjectPath
                ? {
                    _tag: 'out-of-scope',
                    allowedProjectPath,
                    projectPath: outOfScopeRequestedProjectPath,
                  }
                : { _tag: 'valid', payload: { projectPaths: [allowedProjectPath] } }
            }),
          )
        : Effect.succeed({
            _tag: 'valid',
            payload: { projectPaths: validatedProjectPaths },
          } satisfies DocsListPayloadValidation),
    ),
    Effect.catchAll((error) =>
      Effect.succeed<DocsListPayloadValidation>({
        _tag: 'invalid',
        issues: [error.message],
      }),
    ),
  )
}

function normalizeDocsDiscoverPayload(
  input: BrokerDocsRouteInput,
  payload: ExtensionDocsDiscoverPayload,
): Effect.Effect<DocsListPayloadValidation> {
  return normalizeDocsListProjectPaths(input, payload.projectPaths).pipe(
    Effect.map((validation) => {
      if (validation._tag !== 'valid') {
        return validation
      }

      return {
        _tag: 'valid',
        payload: {
          ...validation.payload,
          ...(payload.includeExtensions !== undefined
            ? { includeExtensions: payload.includeExtensions }
            : {}),
        },
      } satisfies DocsListPayloadValidation
    }),
  )
}

function discoverDocs(input: BrokerDocsRouteInput) {
  const decoded = docsDiscoverPayload(input)
  if (!decoded.ok) {
    return payloadDecodeFailure(input, decoded.issues)
  }

  return Effect.gen(function* () {
    const normalized = yield* normalizeDocsDiscoverPayload(input, decoded.payload)
    if (normalized._tag === 'invalid') {
      return yield* payloadDecodeFailure(input, normalized.issues)
    }
    if (normalized._tag === 'out-of-scope') {
      return yield* outOfScopeProjectPath({ ...input, ...normalized })
    }

    const docs = yield* listDocsDiscoveryView(normalized.payload)
    return yield* auditedSuccess({
      invocation: input.invocation,
      timestamp: input.timestamp,
      value: {
        extensionId: input.invocation.extensionId,
        contributionId: input.invocation.contributionId,
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.DOCS,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.DISCOVER_DOCS,
        docs,
      },
    })
  })
}

function resolveTopic(input: BrokerDocsRouteInput) {
  const decoded = docsResolveTopicPayload(input)
  if (!decoded.ok) {
    return payloadDecodeFailure(input, decoded.issues)
  }

  return Effect.gen(function* () {
    const resolvedTopic = yield* resolveDocsTopic(decoded.payload)
    return yield* auditedSuccess({
      invocation: input.invocation,
      timestamp: input.timestamp,
      value: {
        extensionId: input.invocation.extensionId,
        contributionId: input.invocation.contributionId,
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.DOCS,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.RESOLVE_DOCS_TOPIC,
        resolvedTopic,
      },
    })
  })
}

export function routeDocsCapability(input: BrokerDocsRouteInput) {
  if (input.invocation.method === OPENWAGGLE_EXTENSION_BROKER.METHOD.DISCOVER_DOCS) {
    return discoverDocs(input)
  }

  return input.invocation.method === OPENWAGGLE_EXTENSION_BROKER.METHOD.RESOLVE_DOCS_TOPIC
    ? resolveTopic(input)
    : unsupportedMethod(input)
}
