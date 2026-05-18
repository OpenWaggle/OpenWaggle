import { Schema } from '@shared/schema'
import type { McpConfigArray, McpConfigValue } from '@shared/types/mcp'

const mcpConfigArraySchema: Schema.Schema<McpConfigArray> = Schema.mutable(
  Schema.Array(Schema.suspend(() => mcpConfigValueSchema)),
)

const mcpConfigObjectRestSchema = Schema.Record({
  key: Schema.String,
  value: Schema.suspend(() => mcpConfigValueSchema),
})

const mcpConfigObjectSchema = Schema.mutable(mcpConfigObjectRestSchema)

export const mcpConfigValueSchema: Schema.Schema<McpConfigValue> = Schema.suspend(() =>
  Schema.Union(
    Schema.String,
    Schema.Number,
    Schema.Boolean,
    Schema.Null,
    mcpConfigArraySchema,
    mcpConfigObjectSchema,
  ),
)

const mcpDirectToolsSchema = Schema.Union(
  Schema.Boolean,
  Schema.mutable(Schema.Array(Schema.String)),
)

export const mcpAdapterSettingsSchema = mcpConfigObjectSchema

export const mcpServerDefinitionSchema = Schema.Struct(
  {
    command: Schema.optional(Schema.String),
    url: Schema.optional(Schema.String),
    directTools: Schema.optional(mcpDirectToolsSchema),
  },
  mcpConfigObjectRestSchema,
)

export const mcpServerMapSchema = Schema.mutable(
  Schema.Record({
    key: Schema.String,
    value: mcpServerDefinitionSchema,
  }),
)

export const mcpOpenWaggleConfigSchema = Schema.Struct(
  {
    disabledMcpServers: Schema.optional(mcpServerMapSchema),
  },
  mcpConfigObjectRestSchema,
)

export const mcpConfigFileSchema = Schema.Struct(
  {
    imports: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
    settings: Schema.optional(mcpAdapterSettingsSchema),
    mcpServers: Schema.optional(mcpServerMapSchema),
    'mcp-servers': Schema.optional(mcpServerMapSchema),
    openwaggle: Schema.optional(mcpOpenWaggleConfigSchema),
  },
  mcpConfigObjectRestSchema,
)

export const mcpPackageSourceObjectSchema = Schema.Struct(
  {
    source: Schema.String,
  },
  mcpConfigObjectRestSchema,
)

const mcpPackageEntrySchema = Schema.Union(Schema.String, mcpPackageSourceObjectSchema)

export const piAgentSettingsFileSchema = Schema.Struct(
  {
    packages: Schema.optional(Schema.mutable(Schema.Array(mcpPackageEntrySchema))),
  },
  mcpConfigObjectRestSchema,
)
