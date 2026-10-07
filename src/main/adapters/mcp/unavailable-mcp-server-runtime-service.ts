import { Effect, Layer } from 'effect'
import { McpConfigurationError } from '../../ports/mcp-configuration-service'
import { McpServerRuntimeService } from '../../ports/mcp-server-runtime-service'

/**
 * TEMPORARY: stands in for Pi's MCP runtime until the MCP switch wires it in (ADR 0048). Settings
 * and the CLI show every server as not connected, and sign-in reports that it is not available
 * yet. Replace this layer with the live runtime service; nothing else depends on it.
 */
export const MCP_RUNTIME_UNAVAILABLE_MESSAGE =
  'Connecting to MCP servers is not available in this build yet.'

const sessionMcpEnabled = new Map<string, boolean>()

export const UnavailableMcpServerRuntimeServiceLive = Layer.succeed(
  McpServerRuntimeService,
  McpServerRuntimeService.of({
    inspectServer: (input) =>
      Effect.succeed({
        name: input.name,
        state: 'not-connected',
        tools: [],
        error: MCP_RUNTIME_UNAVAILABLE_MESSAGE,
      }),
    signIn: () =>
      Effect.fail(
        new McpConfigurationError({
          reason: 'io',
          message: 'Signing in to MCP servers is not available yet.',
        }),
      ),
    signOut: () => Effect.void,
    getSessionMcpEnabled: (sessionId) =>
      Effect.sync(() => sessionMcpEnabled.get(sessionId) ?? true),
    setSessionMcpEnabled: (sessionId, enabled) =>
      Effect.sync(() => {
        sessionMcpEnabled.set(sessionId, enabled)
      }),
  }),
)
