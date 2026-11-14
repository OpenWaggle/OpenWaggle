import { parseJsonUnknown } from '@shared/schema'
import { Schema } from 'effect'
import { MCP_SCHEMA_PARSE_OPTIONS } from '../../effect-standard-schema'
import {
  buildMcpSessionPayloadV2,
  sessionInputSchemaV2,
} from '../../openwaggle-mcp-session-input-v2'

/**
 * The export query an MCP `tools/call` builds from these arguments. They cross JSON and the
 * tool's input schema first, as a client's do, so a manifest handed back from an earlier page
 * must decode as the tool declares it.
 */
export function mcpExportQuery(input: unknown) {
  const decoded = Schema.decodeUnknownSync(
    sessionInputSchemaV2,
    MCP_SCHEMA_PARSE_OPTIONS,
  )(parseJsonUnknown(JSON.stringify(input)))
  const payload = buildMcpSessionPayloadV2(decoded)
  if (payload.contract !== 'session-query-v2' || payload.request.query.operation !== 'export') {
    throw new Error('Expected MCP export query payload.')
  }
  return payload.request.query
}
