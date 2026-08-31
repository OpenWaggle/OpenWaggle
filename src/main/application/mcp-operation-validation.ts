import { Schema, safeDecodeUnknown } from '@shared/schema'
import { mcpConfigValueSchema, mcpServerDefinitionSchema } from '@shared/schemas/mcp'
import { MCP_CONFIG_SOURCE_IDS } from '@shared/types/mcp'
import * as Effect from 'effect/Effect'
import { createLogger } from '../logger'
import { validateProjectPath } from '../utils/project-path-validation'

const logger = createLogger('mcp-operation')

export const mcpProjectAndSessionFields = {
  projectPath: Schema.optional(Schema.NullOr(Schema.String)),
  sessionId: Schema.optional(Schema.NullOr(Schema.String)),
}

export const mcpGetSettingsSchema = Schema.Struct({
  ...mcpProjectAndSessionFields,
  reconcileRuntime: Schema.optional(Schema.Boolean),
})

export const mcpSetScopeStateSchema = Schema.Struct({
  ...mcpProjectAndSessionFields,
  scope: Schema.Literal('global', 'project', 'session'),
  state: Schema.Literal('inherit', 'on', 'off'),
})

export const mcpSetServerEnabledSchema = Schema.Struct({
  ...mcpProjectAndSessionFields,
  instanceId: Schema.String,
  enabled: Schema.Boolean,
})

export const mcpSetProjectServerEnabledSchema = Schema.Struct({
  ...mcpProjectAndSessionFields,
  instanceId: Schema.String,
  enabled: Schema.Boolean,
})

const mcpServerPermissionGrantSchema = Schema.Struct({
  readRoots: Schema.mutable(Schema.Array(Schema.String)),
  writeRoots: Schema.mutable(Schema.Array(Schema.String)),
  allowNetwork: Schema.Boolean,
})

export const mcpSetServerTrustSchema = Schema.Struct({
  ...mcpProjectAndSessionFields,
  instanceId: Schema.String,
  trusted: Schema.Boolean,
  allowUnsandboxed: Schema.optional(Schema.Boolean),
  permissions: Schema.optional(mcpServerPermissionGrantSchema),
})

export const mcpWriteSourceConfigSchema = Schema.Struct({
  projectPath: Schema.optional(Schema.NullOr(Schema.String)),
  sourceId: Schema.Literal(...MCP_CONFIG_SOURCE_IDS),
  rawJson: Schema.String,
})

export const mcpRemoveServerSchema = Schema.Struct({
  ...mcpProjectAndSessionFields,
  instanceId: Schema.String,
})

const mcpImportSourceSchema = Schema.Literal(
  'codex',
  'claude-code',
  'claude-desktop',
  'opencode',
  'pi',
  'vscode',
  'cursor',
  'windsurf',
  'zed',
)

export const mcpImportPreviewSchema = Schema.Struct({
  projectPath: Schema.optional(Schema.NullOr(Schema.String)),
  sources: Schema.optional(Schema.mutable(Schema.Array(mcpImportSourceSchema))),
})

export const mcpImportApplySchema = Schema.Struct({
  projectPath: Schema.optional(Schema.NullOr(Schema.String)),
  sources: Schema.optional(Schema.mutable(Schema.Array(mcpImportSourceSchema))),
  fingerprints: Schema.mutable(Schema.Array(Schema.String)),
  target: Schema.Literal('global', 'project'),
  conflictPolicy: Schema.Literal('skip', 'replace', 'rename'),
})

export const mcpAddServerSchema = Schema.Struct({
  ...mcpProjectAndSessionFields,
  name: Schema.String,
  definition: mcpServerDefinitionSchema,
  target: Schema.Literal('global', 'project'),
  replace: Schema.optional(Schema.Boolean),
})

export const mcpSetSecretSchema = Schema.Struct({ name: Schema.String, value: Schema.String })
export const mcpRemoveSecretSchema = Schema.Struct({ name: Schema.String })

export const mcpListCapabilitiesSchema = Schema.Struct({
  ...mcpProjectAndSessionFields,
  serverInstanceId: Schema.optional(Schema.String),
})

export const mcpGetPromptSchema = Schema.Struct({
  ...mcpProjectAndSessionFields,
  serverInstanceId: Schema.String,
  name: Schema.String,
  arguments: Schema.optional(
    Schema.mutable(Schema.Record({ key: Schema.String, value: Schema.String })),
  ),
})

export const mcpReadResourceSchema = Schema.Struct({
  ...mcpProjectAndSessionFields,
  serverInstanceId: Schema.String,
  uri: Schema.String,
})

export const mcpReviewRemoteSkillSchema = mcpReadResourceSchema

export const mcpTaskOperationSchema = Schema.Struct({
  ...mcpProjectAndSessionFields,
  serverInstanceId: Schema.String,
  operation: Schema.Literal('list', 'get', 'cancel'),
  taskId: Schema.optional(Schema.String),
})

export const mcpAppToolCallSchema = Schema.Struct({
  ...mcpProjectAndSessionFields,
  serverInstanceId: Schema.String,
  toolName: Schema.String,
  arguments: Schema.mutable(Schema.Record({ key: Schema.String, value: mcpConfigValueSchema })),
})

export const mcpEventSubscriptionSchema = Schema.Struct({
  ...mcpProjectAndSessionFields,
  serverInstanceId: Schema.String,
  enabled: Schema.Boolean,
  resourceUris: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
})

export function decodeMcpOperationInput<A, I>(
  schema: Schema.Schema<A, I>,
  raw: unknown,
  action: string,
) {
  const decoded = safeDecodeUnknown(schema, raw)
  if (decoded.success) return Effect.succeed(decoded.data)
  const error = decoded.issues.join('; ')
  logger.warn(`Invalid MCP ${action} payload`, { error })
  return Effect.fail(new Error(error))
}

export function validateMcpProjectInput<A extends { readonly projectPath?: string | null }>(
  input: A,
) {
  return validateProjectPath(input.projectPath).pipe(
    Effect.map((projectPath) => ({ ...input, projectPath })),
  )
}
