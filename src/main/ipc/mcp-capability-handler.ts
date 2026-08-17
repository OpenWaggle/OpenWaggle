import { Schema, safeDecodeUnknown } from '@shared/schema'
import { mcpConfigValueSchema } from '@shared/schemas/mcp'
import * as Effect from 'effect/Effect'
import { createMcpManagementRuntimeNamespace } from '../domain/mcp/runtime-namespace'
import { createLogger } from '../logger'
import { McpConfigService } from '../ports/mcp-config-service'
import { McpRuntimeService } from '../ports/mcp-runtime-service'
import { validateProjectPath } from './project-path-validation'
import { typedHandle } from './typed-ipc'

const logger = createLogger('ipc-mcp-capabilities')

const projectAndSessionSchema = {
  projectPath: Schema.optional(Schema.NullOr(Schema.String)),
  sessionId: Schema.optional(Schema.NullOr(Schema.String)),
}

const listCapabilitiesSchema = Schema.Struct({
  ...projectAndSessionSchema,
  serverInstanceId: Schema.optional(Schema.String),
})

const getPromptSchema = Schema.Struct({
  ...projectAndSessionSchema,
  serverInstanceId: Schema.String,
  name: Schema.String,
  arguments: Schema.optional(
    Schema.mutable(Schema.Record({ key: Schema.String, value: Schema.String })),
  ),
})

const readResourceSchema = Schema.Struct({
  ...projectAndSessionSchema,
  serverInstanceId: Schema.String,
  uri: Schema.String,
})

const reviewRemoteSkillSchema = Schema.Struct({
  ...projectAndSessionSchema,
  serverInstanceId: Schema.String,
  uri: Schema.String,
})

const taskOperationSchema = Schema.Struct({
  ...projectAndSessionSchema,
  serverInstanceId: Schema.String,
  operation: Schema.Literal('list', 'get', 'cancel'),
  taskId: Schema.optional(Schema.String),
})

const appToolCallSchema = Schema.Struct({
  ...projectAndSessionSchema,
  serverInstanceId: Schema.String,
  toolName: Schema.String,
  arguments: Schema.mutable(Schema.Record({ key: Schema.String, value: mcpConfigValueSchema })),
})

const eventSubscriptionSchema = Schema.Struct({
  ...projectAndSessionSchema,
  serverInstanceId: Schema.String,
  enabled: Schema.Boolean,
  resourceUris: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
})

function decodeInput<A, I>(schema: Schema.Schema<A, I>, raw: unknown, action: string) {
  const decoded = safeDecodeUnknown(schema, raw)
  if (decoded.success) return Effect.succeed(decoded.data)

  const error = decoded.issues.join('; ')
  logger.warn(`Invalid MCP ${action} payload`, { error })
  return Effect.fail(new Error(error))
}

function validateInputProjectPath<A extends { readonly projectPath?: string | null }>(input: A) {
  return validateProjectPath(input.projectPath).pipe(
    Effect.map((projectPath) => ({ ...input, projectPath })),
  )
}

function loadManagementSnapshot(input: {
  readonly projectPath?: string | null
  readonly sessionId?: string | null
}) {
  return Effect.gen(function* () {
    if (!input.projectPath) throw new Error('Open a project before browsing MCP capabilities.')
    const config = yield* McpConfigService
    const runtimeNamespace = createMcpManagementRuntimeNamespace({
      projectPath: input.projectPath,
      sessionId: input.sessionId,
    })
    const sessionId = input.sessionId ?? runtimeNamespace
    const snapshot = yield* config.createTurnSnapshot({
      projectPath: input.projectPath,
      sessionId,
    })
    if (!snapshot) throw new Error('MCP is off for this project or session.')
    return { ...snapshot, runtimeNamespace }
  })
}

function loadTaskSnapshot(input: {
  readonly projectPath?: string | null
  readonly sessionId?: string | null
}) {
  return Effect.gen(function* () {
    if (!input.projectPath) throw new Error('Open a project before managing MCP Tasks.')
    const config = yield* McpConfigService
    const runtimeNamespace = createMcpManagementRuntimeNamespace({
      projectPath: input.projectPath,
      sessionId: input.sessionId,
    })
    const snapshot = yield* config.createTurnSnapshot({
      projectPath: input.projectPath,
      sessionId: input.sessionId ?? runtimeNamespace,
    })
    return snapshot ? { ...snapshot, runtimeNamespace } : null
  })
}

export function registerMcpCapabilityHandlers(): void {
  typedHandle('mcp:list-capabilities', (_event, raw: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* decodeInput(listCapabilitiesSchema, raw, 'capability listing')
      const input = yield* validateInputProjectPath(decoded)
      const snapshot = yield* loadManagementSnapshot(input)
      const runtime = yield* McpRuntimeService
      return yield* runtime.browseCapabilities({
        snapshot,
        ...(input.serverInstanceId ? { serverInstanceId: input.serverInstanceId } : {}),
      })
    }),
  )

  typedHandle('mcp:get-prompt', (_event, raw: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* decodeInput(getPromptSchema, raw, 'prompt read')
      const input = yield* validateInputProjectPath(decoded)
      const snapshot = yield* loadManagementSnapshot(input)
      const runtime = yield* McpRuntimeService
      return yield* runtime.getPrompt({
        snapshot,
        serverInstanceId: input.serverInstanceId,
        name: input.name,
        ...(input.arguments ? { arguments: input.arguments } : {}),
      })
    }),
  )

  typedHandle('mcp:read-resource', (_event, raw: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* decodeInput(readResourceSchema, raw, 'resource read')
      const input = yield* validateInputProjectPath(decoded)
      const snapshot = yield* loadManagementSnapshot(input)
      const runtime = yield* McpRuntimeService
      return yield* runtime.readResource({
        snapshot,
        serverInstanceId: input.serverInstanceId,
        uri: input.uri,
      })
    }),
  )

  typedHandle('mcp:review-remote-skill', (_event, raw: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* decodeInput(reviewRemoteSkillSchema, raw, 'remote Skill review')
      const input = yield* validateInputProjectPath(decoded)
      const snapshot = yield* loadManagementSnapshot(input)
      const runtime = yield* McpRuntimeService
      return yield* runtime.reviewRemoteSkill({
        snapshot,
        serverInstanceId: input.serverInstanceId,
        uri: input.uri,
      })
    }),
  )

  typedHandle('mcp:operate-task', (_event, raw: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* decodeInput(taskOperationSchema, raw, 'task operation')
      const input = yield* validateInputProjectPath(decoded)
      const snapshot = yield* loadTaskSnapshot(input)
      const runtime = yield* McpRuntimeService
      return yield* runtime.operateTask({ snapshot, request: input })
    }),
  )

  typedHandle('mcp:call-app-tool', (_event, raw: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* decodeInput(appToolCallSchema, raw, 'App tool call')
      const input = yield* validateInputProjectPath(decoded)
      const snapshot = yield* loadManagementSnapshot(input)
      const runtime = yield* McpRuntimeService
      return yield* runtime.callAppTool({
        snapshot,
        serverInstanceId: input.serverInstanceId,
        toolName: input.toolName,
        arguments: input.arguments,
      })
    }),
  )

  typedHandle('mcp:set-event-subscription', (_event, raw: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* decodeInput(eventSubscriptionSchema, raw, 'event subscription')
      const input = yield* validateInputProjectPath(decoded)
      const snapshot = yield* loadManagementSnapshot(input)
      const runtime = yield* McpRuntimeService
      return yield* runtime.setEventSubscription({
        snapshot,
        serverInstanceId: input.serverInstanceId,
        enabled: input.enabled,
        resourceUris: input.resourceUris ?? [],
      })
    }),
  )

  typedHandle('mcp:list-events', (_event, raw: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* decodeInput(
        Schema.Struct(projectAndSessionSchema),
        raw,
        'event listing',
      )
      const input = yield* validateInputProjectPath(decoded)
      const runtime = yield* McpRuntimeService
      return yield* runtime.getEvents(input.sessionId)
    }),
  )

  typedHandle('mcp:list-event-subscriptions', (_event, raw: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* decodeInput(
        Schema.Struct(projectAndSessionSchema),
        raw,
        'event subscription listing',
      )
      const input = yield* validateInputProjectPath(decoded)
      const runtime = yield* McpRuntimeService
      return yield* runtime.getEventSubscriptions(input.sessionId)
    }),
  )
}
