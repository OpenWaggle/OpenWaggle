import { Schema } from '@shared/schema'
import type { McpJsonValue } from '@shared/types/mcp'
import { replaceMcpBinaryPayloads } from '@shared/utils/mcp-binary-payload'

const JSON_INDENT_SPACES = 2

/** Draft text reaches the model verbatim, so every binary payload is replaced by a size marker. */
export function mcpAppDraftJson(value: unknown) {
  return JSON.stringify(replaceMcpBinaryPayloads(value), null, JSON_INDENT_SPACES)
}

const isTextBlock = Schema.is(Schema.Struct({ type: Schema.Literal('text'), text: Schema.String }))

function draftTextBlock(entry: McpJsonValue) {
  if (!isTextBlock(entry)) return []
  const text = replaceMcpBinaryPayloads(entry.text)
  return typeof text === 'string' ? [text] : []
}

/** Text an MCP App asks to place in the composer: its text blocks, or its JSON otherwise. */
export function mcpAppDraftText(value: McpJsonValue) {
  if (!Array.isArray(value)) return mcpAppDraftJson(value)
  const text = value.flatMap(draftTextBlock)
  return text.length > 0 ? text.join('\n\n') : mcpAppDraftJson(value)
}
