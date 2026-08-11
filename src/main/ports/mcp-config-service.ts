import type {
  McpAddServerInput,
  McpGetSettingsInput,
  McpImportApplyInput,
  McpImportApplyResult,
  McpImportPreview,
  McpImportPreviewInput,
  McpRemoveServerInput,
  McpServerDefinition,
  McpSetScopeStateInput,
  McpSetServerEnabledInput,
  McpSetServerTrustInput,
  McpSettingsView,
  McpTurnSnapshot,
  McpWriteSourceConfigInput,
} from '@shared/types/mcp'
import { Context, type Effect } from 'effect'

export interface McpConfigServiceShape {
  readonly getServerDefinition: (input: McpRemoveServerInput) => Effect.Effect<{
    readonly instanceId: string
    readonly definition: McpServerDefinition
  }>
  readonly getView: (input?: McpGetSettingsInput) => Effect.Effect<McpSettingsView>
  readonly setScopeState: (input: McpSetScopeStateInput) => Effect.Effect<McpSettingsView>
  readonly setServerEnabled: (input: McpSetServerEnabledInput) => Effect.Effect<McpSettingsView>
  readonly setServerTrust: (input: McpSetServerTrustInput) => Effect.Effect<McpSettingsView>
  readonly writeSourceConfig: (input: McpWriteSourceConfigInput) => Effect.Effect<McpSettingsView>
  readonly removeServer: (input: McpRemoveServerInput) => Effect.Effect<McpSettingsView>
  readonly addServer: (input: McpAddServerInput) => Effect.Effect<McpSettingsView>
  readonly previewImports: (input: McpImportPreviewInput) => Effect.Effect<McpImportPreview>
  readonly applyImports: (input: McpImportApplyInput) => Effect.Effect<McpImportApplyResult>
  readonly createTurnSnapshot: (input: {
    readonly projectPath: string
    readonly executionPath?: string
    readonly sessionId: string
  }) => Effect.Effect<McpTurnSnapshot | null>
}

export class McpConfigService extends Context.Tag('@openwaggle/McpConfigService')<
  McpConfigService,
  McpConfigServiceShape
>() {}
