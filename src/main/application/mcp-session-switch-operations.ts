import { type Schema, safeDecodeUnknown } from '@shared/schema'
import {
  mcpSessionRequestSchema,
  mcpSetSessionEnabledRequestSchema,
} from '@shared/schemas/mcp-configuration'
import * as Effect from 'effect/Effect'
import { McpConfigurationError } from '../ports/mcp-configuration-service'
import { McpServerRuntimeService } from '../ports/mcp-server-runtime-service'

/**
 * A Session's MCP switch (ADR 0051): every Session uses the configured MCP servers until it is
 * switched off, and the switch is Session state, so it changes no file. A Run reads it at start.
 */

function decode<A, I>(schema: Schema.Schema<A, I>, raw: unknown) {
  const decoded = safeDecodeUnknown(schema, raw)
  return decoded.success
    ? Effect.succeed(decoded.data)
    : Effect.fail(
        new McpConfigurationError({ reason: 'validation', message: decoded.issues.join('; ') }),
      )
}

export function getSessionMcpEnabledOperation(raw: unknown) {
  return Effect.gen(function* () {
    const { sessionId } = yield* decode(mcpSessionRequestSchema, raw)
    return yield* (yield* McpServerRuntimeService).getSessionMcpEnabled(sessionId)
  })
}

export function setSessionMcpEnabledOperation(raw: unknown) {
  return Effect.gen(function* () {
    const { sessionId, enabled } = yield* decode(mcpSetSessionEnabledRequestSchema, raw)
    const runtime = yield* McpServerRuntimeService
    yield* runtime.setSessionMcpEnabled(sessionId, enabled)
    return yield* runtime.getSessionMcpEnabled(sessionId)
  })
}
