import { Schema } from '@shared/schema'
import * as Effect from 'effect/Effect'
import { createMcpManagementRuntimeNamespace } from '../domain/mcp/runtime-namespace'
import { McpConfigService } from '../ports/mcp-config-service'
import { McpRuntimeService } from '../ports/mcp-runtime-service'
import {
  decodeMcpOperationInput,
  mcpAppToolCallSchema,
  mcpEventSubscriptionSchema,
  mcpGetPromptSchema,
  mcpListCapabilitiesSchema,
  mcpProjectAndSessionFields,
  mcpReadResourceSchema,
  mcpReviewRemoteSkillSchema,
  mcpTaskOperationSchema,
  validateMcpProjectInput,
} from './mcp-operation-validation'

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
    const snapshot = yield* config.createTurnSnapshot({
      projectPath: input.projectPath,
      sessionId: input.sessionId ?? runtimeNamespace,
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

export function listMcpCapabilitiesOperation(raw: unknown) {
  return Effect.gen(function* () {
    const decoded = yield* decodeMcpOperationInput(
      mcpListCapabilitiesSchema,
      raw,
      'capability listing',
    )
    const input = yield* validateMcpProjectInput(decoded)
    const snapshot = yield* loadManagementSnapshot(input)
    return yield* (yield* McpRuntimeService).browseCapabilities({
      snapshot,
      ...(input.serverInstanceId ? { serverInstanceId: input.serverInstanceId } : {}),
    })
  })
}

export function getMcpPromptOperation(raw: unknown) {
  return Effect.gen(function* () {
    const decoded = yield* decodeMcpOperationInput(mcpGetPromptSchema, raw, 'prompt read')
    const input = yield* validateMcpProjectInput(decoded)
    const snapshot = yield* loadManagementSnapshot(input)
    return yield* (yield* McpRuntimeService).getPrompt({
      snapshot,
      serverInstanceId: input.serverInstanceId,
      name: input.name,
      ...(input.arguments ? { arguments: input.arguments } : {}),
    })
  })
}

export function readMcpResourceOperation(raw: unknown) {
  return Effect.gen(function* () {
    const decoded = yield* decodeMcpOperationInput(mcpReadResourceSchema, raw, 'resource read')
    const input = yield* validateMcpProjectInput(decoded)
    const snapshot = yield* loadManagementSnapshot(input)
    return yield* (yield* McpRuntimeService).readResource({
      snapshot,
      serverInstanceId: input.serverInstanceId,
      uri: input.uri,
    })
  })
}

export function reviewMcpRemoteSkillOperation(raw: unknown) {
  return Effect.gen(function* () {
    const decoded = yield* decodeMcpOperationInput(
      mcpReviewRemoteSkillSchema,
      raw,
      'remote Skill review',
    )
    const input = yield* validateMcpProjectInput(decoded)
    const snapshot = yield* loadManagementSnapshot(input)
    return yield* (yield* McpRuntimeService).reviewRemoteSkill({
      snapshot,
      serverInstanceId: input.serverInstanceId,
      uri: input.uri,
    })
  })
}

export function operateMcpTaskOperation(raw: unknown) {
  return Effect.gen(function* () {
    const decoded = yield* decodeMcpOperationInput(mcpTaskOperationSchema, raw, 'task operation')
    const input = yield* validateMcpProjectInput(decoded)
    const snapshot = yield* loadTaskSnapshot(input)
    return yield* (yield* McpRuntimeService).operateTask({ snapshot, request: input })
  })
}

export function callMcpAppToolOperation(raw: unknown) {
  return Effect.gen(function* () {
    const decoded = yield* decodeMcpOperationInput(mcpAppToolCallSchema, raw, 'App tool call')
    const input = yield* validateMcpProjectInput(decoded)
    const snapshot = yield* loadManagementSnapshot(input)
    return yield* (yield* McpRuntimeService).callAppTool({
      snapshot,
      serverInstanceId: input.serverInstanceId,
      toolName: input.toolName,
      arguments: input.arguments,
    })
  })
}

export function setMcpEventSubscriptionOperation(raw: unknown) {
  return Effect.gen(function* () {
    const decoded = yield* decodeMcpOperationInput(
      mcpEventSubscriptionSchema,
      raw,
      'event subscription',
    )
    const input = yield* validateMcpProjectInput(decoded)
    const snapshot = yield* loadManagementSnapshot(input)
    return yield* (yield* McpRuntimeService).setEventSubscription({
      snapshot,
      serverInstanceId: input.serverInstanceId,
      enabled: input.enabled,
      resourceUris: input.resourceUris ?? [],
    })
  })
}

const mcpEventsInputSchema = Schema.Struct(mcpProjectAndSessionFields)

export function listMcpEventsOperation(raw: unknown = {}) {
  return Effect.gen(function* () {
    const decoded = yield* decodeMcpOperationInput(mcpEventsInputSchema, raw, 'event listing')
    const input = yield* validateMcpProjectInput(decoded)
    return yield* (yield* McpRuntimeService).getEvents(input.sessionId)
  })
}

export function listMcpEventSubscriptionsOperation(raw: unknown = {}) {
  return Effect.gen(function* () {
    const decoded = yield* decodeMcpOperationInput(
      mcpEventsInputSchema,
      raw,
      'event subscription listing',
    )
    const input = yield* validateMcpProjectInput(decoded)
    return yield* (yield* McpRuntimeService).getEventSubscriptions(input.sessionId)
  })
}
