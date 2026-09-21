import { buildMcpSessionPayloadV2 } from '../../openwaggle-mcp-session-input-v2'

export function mcpExportQuery(input: Parameters<typeof buildMcpSessionPayloadV2>[0]) {
  const payload = buildMcpSessionPayloadV2(input)
  if (payload.contract !== 'session-query-v2' || payload.request.query.operation !== 'export') {
    throw new Error('Expected MCP export query payload.')
  }
  return payload.request.query
}
