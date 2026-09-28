import type { ImageContent, TextContent } from '@earendil-works/pi-ai'
import { MCP_CONFIG } from '@shared/constants/mcp'
import { replaceMcpBinaryPayloads } from '@shared/utils/mcp-binary-payload'

/**
 * Model-facing content for an MCP tool result.
 *
 * MCP servers return binary payloads (screenshots, audio, embedded resource blobs) as base64 strings
 * inside their content blocks. Serializing those blocks verbatim into the text part of a Pi tool
 * result makes the model tokenize the base64: one Chrome DevTools screenshot costs several hundred
 * thousand tokens and can overflow the context window in a single tool step, while Pi's chars/4
 * estimate under-counts base64 so automatic compaction cannot anticipate it. Images are therefore
 * forwarded as native Pi image content (Pi downgrades them to a placeholder for models without
 * image input) and every binary payload is replaced by a short numbered marker in the serialized
 * text. The complete MCP result stays in `details` for attribution, MCP Apps, and the UI.
 */
export interface McpModelFacingContent {
  readonly content: (TextContent | ImageContent)[]
}

/** Serializes an MCP gateway or orchestration payload for the model without inline base64. */
export function mcpModelFacingContent(payload: unknown): McpModelFacingContent {
  const images: ImageContent[] = []
  const text = JSON.stringify(
    replaceMcpBinaryPayloads(payload, {
      onImage: ({ data, mimeType }) => {
        if (images.length >= MCP_CONFIG.MAX_RESULT_IMAGES) return null
        images.push({ type: 'image', data, mimeType })
        return images.length
      },
    }),
  )
  return { content: [{ type: 'text', text }, ...images] }
}
