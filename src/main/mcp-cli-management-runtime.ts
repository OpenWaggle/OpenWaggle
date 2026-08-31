import type { HostBackedMcpGuiChannel } from '@shared/types/host-ui-protocol'
import { LOCAL_SESSION_CURRENT_REVISION } from '@shared/types/local-session-protocol'
import type {
  McpAddServerInput,
  McpAuthorizeServerResult,
  McpGetSettingsInput,
  McpImportApplyInput,
  McpImportApplyResult,
  McpImportPreview,
  McpImportPreviewInput,
  McpRemoveServerInput,
  McpSecretSummary,
  McpSetProjectServerEnabledInput,
  McpSetScopeStateInput,
  McpSetServerEnabledInput,
  McpSetServerTrustInput,
  McpSettingsView,
  McpWriteSourceConfigInput,
} from '@shared/types/mcp'
import { executeHostUi } from './application/configured-host-ui-client'
import { createLocalSessionCliClientInput } from './local-session-cli-client'
import type { ParsedArguments } from './mcp-cli-arguments'

export interface McpCliConfigService {
  readonly getView: (input?: McpGetSettingsInput) => Promise<McpSettingsView>
  readonly setScopeState: (input: McpSetScopeStateInput) => Promise<McpSettingsView>
  readonly setServerEnabled: (input: McpSetServerEnabledInput) => Promise<McpSettingsView>
  readonly setProjectServerEnabled: (
    input: McpSetProjectServerEnabledInput,
  ) => Promise<McpSettingsView>
  readonly setServerTrust: (input: McpSetServerTrustInput) => Promise<McpSettingsView>
  readonly writeSourceConfig: (input: McpWriteSourceConfigInput) => Promise<McpSettingsView>
  readonly removeServer: (input: McpRemoveServerInput) => Promise<McpSettingsView>
  readonly addServer: (input: McpAddServerInput) => Promise<McpSettingsView>
  readonly previewImports: (input: McpImportPreviewInput) => Promise<McpImportPreview>
  readonly applyImports: (input: McpImportApplyInput) => Promise<McpImportApplyResult>
}

export interface McpCliVault {
  readonly list: () => Promise<readonly McpSecretSummary[]>
  readonly set: (name: string, value: string) => Promise<readonly McpSecretSummary[]>
  readonly remove: (name: string) => Promise<readonly McpSecretSummary[]>
}

export interface McpCliManagementRuntime {
  readonly service: McpCliConfigService
  readonly vault: McpCliVault
  readonly authorizeServer: (input: McpRemoveServerInput) => Promise<McpAuthorizeServerResult>
  readonly logoutServer: (input: McpRemoveServerInput) => Promise<unknown>
  readonly dispose: () => Promise<void>
}

export async function createMcpCliManagementRuntime(
  args: ParsedArguments,
): Promise<McpCliManagementRuntime> {
  const client = await createLocalSessionCliClientInput(args, {
    supportedRevisions: [LOCAL_SESSION_CURRENT_REVISION],
  })
  const invoke = <C extends HostBackedMcpGuiChannel>(channel: C, input?: unknown) =>
    executeHostUi({ client, channel, args: input === undefined ? [] : [input] })

  return {
    service: {
      getView: (input) => invoke('mcp:get-settings', input ?? {}),
      setScopeState: (input) => invoke('mcp:set-scope-state', input),
      setServerEnabled: (input) => invoke('mcp:set-server-enabled', input),
      setProjectServerEnabled: (input) => invoke('mcp:set-project-server-enabled', input),
      setServerTrust: (input) => invoke('mcp:set-server-trust', input),
      writeSourceConfig: (input) => invoke('mcp:write-source-config', input),
      removeServer: (input) => invoke('mcp:remove-server', input),
      addServer: (input) => invoke('mcp:add-server', input),
      previewImports: (input) => invoke('mcp:preview-imports', input),
      applyImports: (input) => invoke('mcp:apply-imports', input),
    },
    vault: {
      list: () => invoke('mcp:list-secrets'),
      set: (name, value) => invoke('mcp:set-secret', { name, value }),
      remove: (name) => invoke('mcp:remove-secret', { name }),
    },
    authorizeServer: (input) => invoke('mcp:authorize-server', input),
    logoutServer: (input) => invoke('mcp:logout-server', input),
    dispose: () => Promise.resolve(),
  }
}
