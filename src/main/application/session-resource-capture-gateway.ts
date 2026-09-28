import type { ToolCallResult } from '@shared/types/tools'
import { isRecord } from '@shared/utils/validation'

/**
 * The MCP copy of a gateway result, cataloged once. An MCP App result mirrors the tool's content
 * blocks, so that copy is kept only when the gateway result exposes structured content instead.
 */
export function mcpGatewayResultForCapture(gatewayResult: Readonly<Record<string, unknown>>) {
  const { app, ...result } = gatewayResult
  const appToolResult = isRecord(app) && isRecord(app.toolResult) ? app.toolResult : null
  return appToolResult && appToolResult.structuredContent !== undefined
    ? { ...result, appContent: appToolResult.content }
    : result
}

function gatewayDetailsPayload(value: unknown) {
  if (!isRecord(value) || value.kind !== 'gateway' || !isRecord(value.result)) return null
  return { ...value, result: mcpGatewayResultForCapture(value.result) }
}

/**
 * An MCP gateway result keeps the complete MCP payload in `details`; its model-facing `content`
 * is derived from that payload (images are copied there and may be resized by Pi). Scanning both
 * would catalog every MCP image twice, so only the MCP copy is used.
 */
export function capturedToolOutput(toolResult: ToolCallResult) {
  const projectedDetails = isRecord(toolResult.result) ? toolResult.result.details : undefined
  return (
    gatewayDetailsPayload(toolResult.details) ??
    gatewayDetailsPayload(projectedDetails) ??
    toolResult.result
  )
}
