import { Schema } from '@shared/schema'
import type {
  McpAppFrameRegisterInput,
  McpAppFrameUnregisterInput,
} from '@shared/types/mcp-app-frame'

const origins = Schema.Array(Schema.String)

export const mcpAppFrameRegisterInputSchema: Schema.Schema<McpAppFrameRegisterInput> =
  Schema.Struct({
    frameId: Schema.String,
    html: Schema.String,
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
