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
  sourceName: Schema.optionalWith(Schema.String, { exact: true }),
  sourceDigest: Schema.String,
  importerVersion: Schema.Literal(1),
  baselineDigest: Schema.String,
  importedAt: Schema.Number,
})

const agentDefinitionDocumentSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  $schema: Schema.optionalWith(Schema.String, { exact: true }),
  name: Schema.String,
  description: Schema.String,
  model: Schema.optionalWith(Schema.String, { exact: true }),
  reasoning: Schema.optionalWith(Schema.Literal(...THINKING_LEVELS), { exact: true }),
  tools: Schema.optionalWith(Schema.Array(Schema.String), { exact: true }),
  skills: Schema.optionalWith(Schema.Array(Schema.String), { exact: true }),
  mcpServers: Schema.optionalWith(Schema.Array(Schema.String), { exact: true }),
  sessionCapabilities: Schema.optionalWith(Schema.Array(Schema.Literal(...SESSION_CAPABILITIES)), {
    exact: true,
  }),
  authorizationMode: Schema.optionalWith(Schema.Literal(...AGENT_AUTHORIZATION_MODES), {
    exact: true,
  }),
  workspace: Schema.optionalWith(Schema.Literal('share-parent', 'local', 'new-worktree'), {
    exact: true,
  }),
  import: Schema.optionalWith(importProvenanceSchema, { exact: true }),
  instructions: Schema.String,
})

const projectPathSchema = { projectPath: Schema.String }
const sourceImportSchema = {
  ...projectPathSchema,
  sourcePath: Schema.String,
  sourceTool: Schema.optionalWith(sourceToolSchema, { exact: true }),
  sourceName: Schema.optionalWith(Schema.String, { exact: true }),
  targetScope: scopeSchema,
}

const importApplySchema = Schema.Union(
  Schema.Struct({
    operation: Schema.Literal('import-apply'),
    ...sourceImportSchema,
    expectedSourceDigest: Schema.String,
    replaceExisting: Schema.Literal(true),
    expectedContentDigest: Schema.String,
  }),
  Schema.Struct({
    operation: Schema.Literal('import-apply'),
    ...sourceImportSchema,
    expectedSourceDigest: Schema.String,
    replaceExisting: Schema.optionalWith(Schema.Literal(false), { exact: true }),
    expectedContentDigest: Schema.optionalWith(Schema.String, { exact: true }),
  }),
)

export const agentDefinitionManagementCommandSchema = Schema.Union(
  Schema.Struct({ operation: Schema.Literal('list'), ...projectPathSchema }),
  Schema.Struct({
    operation: Schema.Literal('write'),
    ...projectPathSchema,
    scope: scopeSchema,
    document: agentDefinitionDocumentSchema,
    replaceExisting: Schema.optionalWith(Schema.Boolean, { exact: true }),
    expectedContentDigest: Schema.optionalWith(Schema.String, { exact: true }),
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
    expectedContentDigest: Schema.optionalWith(Schema.String, { exact: true }),
  }),
  Schema.Struct({ operation: Schema.Literal('import-plan'), ...sourceImportSchema }),
  importApplySchema,
  Schema.Struct({
    operation: Schema.Literal('refresh-plan'),
    ...projectPathSchema,
    name: Schema.String,
    scope: Schema.optionalWith(scopeSchema, { exact: true }),
  }),
  Schema.Struct({
    operation: Schema.Literal('refresh-apply'),
    ...projectPathSchema,
    name: Schema.String,
    scope: Schema.optionalWith(scopeSchema, { exact: true }),
    expectedSourceDigest: Schema.String,
    expectedContentDigest: Schema.String,
    replaceModified: Schema.optionalWith(Schema.Boolean, { exact: true }),
  }),
)
