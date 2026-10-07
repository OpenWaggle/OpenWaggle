import type {
  McpConfigurationView,
  McpServerExposure,
  McpWriteDestination,
} from '@shared/types/mcp-configuration'
import { Context, Data, type Effect } from 'effect'

export class McpConfigurationError extends Data.TaggedError('McpConfigurationError')<{
  readonly reason: 'not-found' | 'validation' | 'io'
  readonly message: string
}> {}

export interface McpConfigurationScopeInput {
  /** The durable project root; null for global-only views and changes. */
  readonly projectPath: string | null
}

export interface McpSetServerEnabledInput extends McpConfigurationScopeInput {
  readonly name: string
  readonly enabled: boolean
  /**
   * `server`: change the server where it is defined (or overridden). `project`: switch it for this
   * project only, with an override in a project file (OpenWaggle's unless `destination` says).
   */
  readonly target: 'server' | 'project'
  readonly destination?: McpWriteDestination
}

export interface McpSetServerExposureInput extends McpConfigurationScopeInput {
  readonly name: string
  readonly exposure?: McpServerExposure
  /** Per-tool exposure to set; `null` removes a tool's entry. */
  readonly toolExposure?: Readonly<Record<string, McpServerExposure | null>>
}

export interface McpAddServerInput extends McpConfigurationScopeInput {
  readonly name: string
  /** A Pi `mcpServers` entry; vault secret references only for OpenWaggle's files. */
  readonly entry: Readonly<Record<string, unknown>>
  /** Defaults to OpenWaggle's file for `scope`. */
  readonly destination?: McpWriteDestination
  readonly scope: 'global' | 'project'
  /** Write over an entry of the same exact name (an import's "replace"); never a look-alike. */
  readonly replace?: boolean
}

export interface McpRemoveServerInput extends McpConfigurationScopeInput {
  readonly name: string
}

/** The ADR 0048 MCP file set: the merged view and the writes Settings and the CLI make. */
export interface McpConfigurationServiceShape {
  readonly getView: (
    input: McpConfigurationScopeInput,
  ) => Effect.Effect<McpConfigurationView, McpConfigurationError>
  readonly setServerEnabled: (
    input: McpSetServerEnabledInput,
  ) => Effect.Effect<void, McpConfigurationError>
  readonly setServerExposure: (
    input: McpSetServerExposureInput,
  ) => Effect.Effect<void, McpConfigurationError>
  readonly addServer: (input: McpAddServerInput) => Effect.Effect<void, McpConfigurationError>
  readonly removeServer: (input: McpRemoveServerInput) => Effect.Effect<void, McpConfigurationError>
  /** Records a write made elsewhere, such as Pi's `/mcp` inside a Run, for `onChange` listeners. */
  readonly changed: (filePath: string) => void
  /** Called after every write made here or by Pi's `/mcp`, with the file that changed. */
  readonly onChange: (listener: (filePath: string) => void) => () => void
}

export class McpConfigurationService extends Context.Tag('@openwaggle/McpConfigurationService')<
  McpConfigurationService,
  McpConfigurationServiceShape
>() {}
