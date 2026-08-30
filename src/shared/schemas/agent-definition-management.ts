import { Schema } from '@shared/schema'
import { AGENT_AUTHORIZATION_MODES } from '@shared/types/agent-authorization'
import { SESSION_CAPABILITIES } from '@shared/types/session-capability'
import { THINKING_LEVELS } from '@shared/types/settings'

const scopeSchema = Schema.Literal('project', 'portable-project', 'user')
const importSourceSchema = Schema.Literal(
  'openwaggle',
  'codex',
  'claude-code',
  'cursor',
  'gemini-cli',
  'github-copilot',
  'opencode',
)
const sourceToolSchema = Schema.Union(importSourceSchema, Schema.Literal('auto'))

const importProvenanceSchema = Schema.Struct({
  sourceTool: importSourceSchema,
  sourcePath: Schema.String,
  sourceDigest: Schema.String,
  importerVersion: Schema.Literal(1),
  baselineDigest: Schema.String,
  importedAt: Schema.Number,
})

const agentDefinitionDocumentSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  $schema: Schema.optional(Schema.String),
  name: Schema.String,
  description: Schema.String,
  model: Schema.optional(Schema.String),
  reasoning: Schema.optional(Schema.Literal(...THINKING_LEVELS)),
  tools: Schema.optional(Schema.Array(Schema.String)),
  skills: Schema.optional(Schema.Array(Schema.String)),
  mcpServers: Schema.optional(Schema.Array(Schema.String)),
  sessionCapabilities: Schema.optional(Schema.Array(Schema.Literal(...SESSION_CAPABILITIES))),
  authorizationMode: Schema.optional(Schema.Literal(...AGENT_AUTHORIZATION_MODES)),
  workspace: Schema.optional(Schema.Literal('share-parent', 'local', 'new-worktree')),
  import: Schema.optional(importProvenanceSchema),
  instructions: Schema.String,
})

const projectPathSchema = { projectPath: Schema.String }
const sourceImportSchema = {
  ...projectPathSchema,
  sourcePath: Schema.String,
  sourceTool: Schema.optional(sourceToolSchema),
  sourceName: Schema.optional(Schema.String),
  targetScope: scopeSchema,
}

export const agentDefinitionManagementCommandSchema = Schema.Union(
  Schema.Struct({ operation: Schema.Literal('list'), ...projectPathSchema }),
  Schema.Struct({
    operation: Schema.Literal('write'),
    ...projectPathSchema,
    scope: scopeSchema,
    document: agentDefinitionDocumentSchema,
    replaceExisting: Schema.optional(Schema.Boolean),
    expectedContentDigest: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    operation: Schema.Literal('duplicate'),
    ...projectPathSchema,
    sourceName: Schema.String,
    targetName: Schema.String,
    targetScope: scopeSchema,
  }),
  Schema.Struct({
    operation: Schema.Literal('delete'),
    ...projectPathSchema,
    name: Schema.String,
    scope: scopeSchema,
    expectedContentDigest: Schema.optional(Schema.String),
  }),
  Schema.Struct({ operation: Schema.Literal('import-plan'), ...sourceImportSchema }),
  Schema.Struct({
    operation: Schema.Literal('import-apply'),
    ...sourceImportSchema,
    expectedSourceDigest: Schema.String,
    replaceExisting: Schema.optional(Schema.Boolean),
    expectedContentDigest: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    operation: Schema.Literal('refresh-plan'),
    ...projectPathSchema,
    name: Schema.String,
  }),
  Schema.Struct({
    operation: Schema.Literal('refresh-apply'),
    ...projectPathSchema,
    name: Schema.String,
    expectedSourceDigest: Schema.String,
    replaceModified: Schema.optional(Schema.Boolean),
  }),
)
