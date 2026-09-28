import type { ImageContent, TextContent } from '@earendil-works/pi-ai'
import { MCP_CONFIG } from '@shared/constants/mcp'
import { isRecord } from '@shared/utils/validation'

/**
 * Model-facing content for an MCP tool result.
 *
 * MCP servers return binary payloads (screenshots, audio, embedded resource blobs) as base64 strings
 * inside their content blocks. Serializing those blocks verbatim into the text part of a Pi tool
 * result makes the model tokenize the base64: one Chrome DevTools screenshot costs several hundred
 * thousand tokens and can overflow the context window in a single tool step, while Pi's chars/4
 * estimate under-counts base64 so automatic compaction cannot anticipate it. Images are therefore
 * forwarded as native Pi image content — Pi downgrades them to a placeholder for models without
 * image input — and every binary payload is replaced by a short marker in the serialized text.
 * The complete MCP result stays in `details` for attribution, MCP Apps, and the UI.
 */
export interface McpModelFacingContent {
  readonly content: (TextContent | ImageContent)[]
}

const MODEL_IMAGE_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
])
const BASE64_PAYLOAD_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/

interface BinaryCollector {
  readonly images: ImageContent[]
  readonly attachedImageData: Set<string>
}

function isAttachableImage(data: string, mimeType: unknown): mimeType is string {
  return (
    typeof mimeType === 'string' &&
    MODEL_IMAGE_MIME_TYPES.has(mimeType) &&
    data.length > 0 &&
    BASE64_PAYLOAD_PATTERN.test(data)
  )
}

function omittedMarker(kind: string, data: string) {
  return `[${kind} data omitted from text: ${String(data.length)} base64 characters]`
}

function imageDataMarker(data: string, mimeType: unknown, collector: BinaryCollector) {
  if (!isAttachableImage(data, mimeType)) return omittedMarker('image', data)
  if (collector.attachedImageData.has(data)) {
    return `[image attached to this tool result: ${mimeType}]`
  }
  if (collector.images.length >= MCP_CONFIG.MAX_RESULT_IMAGES) {
    return omittedMarker(
      `image (limit of ${String(MCP_CONFIG.MAX_RESULT_IMAGES)} attached images reached)`,
      data,
    )
  }
  collector.attachedImageData.add(data)
  collector.images.push({ type: 'image', data, mimeType })
  return `[image attached to this tool result: ${mimeType}]`
}

function replaceBinaryPayloads(value: unknown, collector: BinaryCollector): unknown {
  if (Array.isArray(value)) return value.map((item) => replaceBinaryPayloads(item, collector))
  if (!isRecord(value)) return value

  if (value.type === 'image' && typeof value.data === 'string') {
    return { ...value, data: imageDataMarker(value.data, value.mimeType, collector) }
  }
  if (value.type === 'audio' && typeof value.data === 'string') {
    return { ...value, data: omittedMarker('audio', value.data) }
  }

  const entries = Object.entries(value).map(([key, entry]) => {
    if (key === 'blob' && typeof entry === 'string' && typeof value.uri === 'string') {
      return [key, omittedMarker('resource blob', entry)]
    }
    return [key, replaceBinaryPayloads(entry, collector)]
  })
  return Object.fromEntries(entries)
}

/** Serializes an MCP gateway or orchestration payload for the model without inline base64. */
export function mcpModelFacingContent(payload: unknown): McpModelFacingContent {
  const collector: BinaryCollector = { images: [], attachedImageData: new Set() }
  const text = JSON.stringify(replaceBinaryPayloads(payload, collector))
  return { content: [{ type: 'text', text }, ...collector.images] }
}
