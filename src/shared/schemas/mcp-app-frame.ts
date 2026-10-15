import {
  MAX_MCP_APP_DECLARED_ORIGINS,
  MAX_MCP_APP_DOCUMENT_BYTES,
} from '@shared/constants/mcp-app-frame'
import { Schema } from '@shared/schema'
import type {
  McpAppFrameRegisterInput,
  McpAppFrameUnregisterInput,
} from '@shared/types/mcp-app-frame'

// The renderer sends declarations it already reduced, so anything larger is refused at the boundary.
/** The document's size as the Host counts it: UTF-8 bytes, not string length. */
function utf8Bytes(value: string) {
  return new TextEncoder().encode(value).byteLength
}

const origins = Schema.Array(Schema.String).pipe(Schema.maxItems(MAX_MCP_APP_DECLARED_ORIGINS))

export const mcpAppFrameRegisterInputSchema: Schema.Schema<McpAppFrameRegisterInput> =
  Schema.Struct({
    frameId: Schema.String,
    html: Schema.String.pipe(
      Schema.filter((html) => utf8Bytes(html) <= MAX_MCP_APP_DOCUMENT_BYTES, {
        message: () => 'MCP App document is too large',
      }),
    ),
    csp: Schema.Struct({
      connectDomains: origins,
      resourceDomains: origins,
      frameDomains: origins,
      baseUriDomains: origins,
    }),
  })

export const mcpAppFrameUnregisterInputSchema: Schema.Schema<McpAppFrameUnregisterInput> =
  Schema.Struct({
    frameId: Schema.String,
    registrationId: Schema.String,
  })
