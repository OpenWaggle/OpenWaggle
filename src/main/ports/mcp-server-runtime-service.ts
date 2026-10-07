import type { McpServerInspection } from '@shared/types/mcp-configuration'
import { Context, type Effect } from 'effect'
import type { McpConfigurationError, McpConfigurationScopeInput } from './mcp-configuration-service'

export interface McpServerScopeInput extends McpConfigurationScopeInput {
  readonly name: string
}

export interface McpSignInResult {
  /** Signed in and reconnected; false when the user cancelled. */
  readonly signedIn: boolean
  /**
   * The authorization page, when it could not be opened for the user (for example during
   * non-disruptive automation), so a client can show it.
   */
  readonly authorizationUrl?: string
}

/**
 * The live side of Settings > MCP and the MCP CLI: connecting to a server to show its state and
 * tools, the Host-owned OAuth sign-in shared by GUI and CLI, and a Session's MCP switch.
 */
export interface McpServerRuntimeServiceShape {
  /** Connects to the server outside any Session, lists its tools, and disconnects. */
  readonly inspectServer: (
    input: McpServerScopeInput,
  ) => Effect.Effect<McpServerInspection, McpConfigurationError>
  readonly signIn: (
    input: McpServerScopeInput,
  ) => Effect.Effect<McpSignInResult, McpConfigurationError>
  /** Deletes OpenWaggle's stored sign-in; Pi's own `mcp-auth.json` is never written. */
  readonly signOut: (input: McpServerScopeInput) => Effect.Effect<void, McpConfigurationError>
  /** Session-level MCP off is Session state only; it changes no file. */
  readonly getSessionMcpEnabled: (sessionId: string) => Effect.Effect<boolean>
  readonly setSessionMcpEnabled: (sessionId: string, enabled: boolean) => Effect.Effect<void>
}

export class McpServerRuntimeService extends Context.Tag('@openwaggle/McpServerRuntimeService')<
  McpServerRuntimeService,
  McpServerRuntimeServiceShape
>() {}
