import type { McpServerInspection, McpServerStatusView } from '@shared/types/mcp-configuration'
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
 * The live side of Settings > MCP and the MCP CLI: a server's state without connecting,
 * connecting to it on request to show its state and tools, the Host-owned OAuth sign-in shared by GUI and CLI, and a Session's MCP switch.
 */
export interface McpServerRuntimeServiceShape {
  /**
   * Connects to the server outside any Session, lists its tools, and disconnects. The result is
   * remembered as the server's last check.
   */
  readonly inspectServer: (
    input: McpServerScopeInput,
  ) => Effect.Effect<McpServerInspection, McpConfigurationError>
  /**
   * Every configured server's state without connecting: a Session's warm connection when one
   * exists, otherwise the last check, otherwise not checked. Starts no server and sends nothing.
   */
  readonly getServerStatuses: (
    input: McpConfigurationScopeInput,
  ) => Effect.Effect<readonly McpServerStatusView[], McpConfigurationError>
  readonly signIn: (
    input: McpServerScopeInput,
  ) => Effect.Effect<McpSignInResult, McpConfigurationError>
  /** Deletes OpenWaggle's stored sign-in; Pi's own `mcp-auth.json` is never written. */
  readonly signOut: (input: McpServerScopeInput) => Effect.Effect<void, McpConfigurationError>
  /** Session-level MCP off is Session state only; it changes no file. */
  readonly getSessionMcpEnabled: (sessionId: string) => Effect.Effect<boolean>
  readonly setSessionMcpEnabled: (
    sessionId: string,
    enabled: boolean,
  ) => Effect.Effect<void, McpConfigurationError>
}

export class McpServerRuntimeService extends Context.Tag('@openwaggle/McpServerRuntimeService')<
  McpServerRuntimeService,
  McpServerRuntimeServiceShape
>() {}
