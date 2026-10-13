import { Schema } from '@shared/schema'
import type { McpConfigArray, McpConfigValue } from '@shared/types/mcp'

const mcpConfigArraySchema: Schema.Schema<McpConfigArray> = Schema.mutable(
  Schema.Array(Schema.suspend(() => mcpConfigValueSchema)),
)

const mcpConfigObjectSchema = Schema.mutable(
  Schema.Record({
    key: Schema.String,
    value: Schema.suspend(() => mcpConfigValueSchema),
  }),
)

/** Any JSON value, as MCP messages and MCP App payloads carry them. */
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
