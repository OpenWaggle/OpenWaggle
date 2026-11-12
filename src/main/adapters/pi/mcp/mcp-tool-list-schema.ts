import { Schema, type SchemaType } from '@shared/schema'
import { lenientOptional } from '@shared/schemas/lenient'
import { Option } from 'effect'

/**
 * The parts of MCP `tools/list` and `tools/call` results OpenWaggle reads as they pass through
 * to Pi. A server writes these, so a field of the wrong type reads as absent and a listed tool
 * without a string name is skipped, as the readers always did.
 */

const appUiMetaSchema = Schema.Struct({
  resourceUri: lenientOptional(Schema.String),
  visibility: lenientOptional(Schema.Array(Schema.Unknown)),
})

/** A tool's `_meta`: MCP Apps' `ui`, or the older `ui/resourceUri`. */
export const mcpToolMetaSchema = Schema.Struct({
  ui: lenientOptional(appUiMetaSchema),
  'ui/resourceUri': lenientOptional(Schema.String),
})

const listedToolSchema = Schema.Struct({
  name: Schema.String,
  title: lenientOptional(Schema.String),
  description: lenientOptional(Schema.String),
  _meta: lenientOptional(mcpToolMetaSchema),
})

export type ListedMcpTool = SchemaType<typeof listedToolSchema>

const toolListPageSchema = Schema.Struct({
  tools: Schema.Array(Schema.Unknown),
  nextCursor: lenientOptional(Schema.String),
})

const decodePage = Schema.decodeUnknownOption(toolListPageSchema)
const decodeTool = Schema.decodeUnknownOption(listedToolSchema)

/** A `tools/list` result page, or undefined when the result has no `tools` array. */
export function mcpToolListPage(result: unknown) {
  const page = Option.getOrUndefined(decodePage(result))
  if (!page) return undefined
  const tools = page.tools.flatMap((tool: unknown) => Option.toArray(decodeTool(tool)))
  return { tools, ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }) }
}

/** A listed tool's `ui://` resource: `_meta.ui.resourceUri`, or the older `_meta["ui/resourceUri"]`. */
export function mcpToolAppResourceUri(tool: ListedMcpTool) {
  const meta = tool._meta
  if (!meta) return undefined
  const uri = meta.ui ? meta.ui.resourceUri : meta['ui/resourceUri']
  return uri?.startsWith('ui://') ? uri : undefined
}

const listParamsSchema = Schema.Struct({ cursor: lenientOptional(Schema.String) })

/** The cursor of `tools/list` params, when they continue a listing. */
export function mcpListCursor(params: unknown) {
  return Option.getOrUndefined(Schema.decodeUnknownOption(listParamsSchema)(params))?.cursor
}

/** The fields of a `tools/call` result OpenWaggle passes to an MCP App; each is checked there. */
const toolCallResultSchema = Schema.Struct({
  content: Schema.optional(Schema.Unknown),
  structuredContent: Schema.optional(Schema.Unknown),
  isError: Schema.optional(Schema.Unknown),
})

export type McpToolCallResultFields = SchemaType<typeof toolCallResultSchema>

/** The result's fields; a result that is not an object has none. */
export function mcpToolCallResultFields(result: unknown): McpToolCallResultFields {
  return Option.getOrElse(
    Schema.decodeUnknownOption(toolCallResultSchema)(result),
    (): McpToolCallResultFields => ({}),
  )
}
