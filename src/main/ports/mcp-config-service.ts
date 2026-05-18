import type {
  McpSetAdapterEnabledInput,
  McpSetServerEnabledInput,
  McpSettingsView,
  McpWriteSourceConfigInput,
} from '@shared/types/mcp'
import { Context, type Effect } from 'effect'

export interface McpConfigServiceShape {
  readonly getView: (projectPath?: string | null) => Effect.Effect<McpSettingsView>
  readonly setAdapterEnabled: (input: McpSetAdapterEnabledInput) => Effect.Effect<McpSettingsView>
  readonly setServerEnabled: (input: McpSetServerEnabledInput) => Effect.Effect<McpSettingsView>
  readonly writeSourceConfig: (input: McpWriteSourceConfigInput) => Effect.Effect<McpSettingsView>
}

export class McpConfigService extends Context.Tag('@openwaggle/McpConfigService')<
  McpConfigService,
  McpConfigServiceShape
>() {}
