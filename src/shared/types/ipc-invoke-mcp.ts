import type {
  McpAppCatalogInput,
  McpAppCatalogResult,
  McpAppToolCallInput,
  McpAppToolCallResult,
  McpReadResourceInput,
  McpRemoveSecretInput,
  McpResourceResult,
  McpSecretSummary,
  McpSetSecretInput,
} from './mcp'
import type {
  McpAppFrameRegisterInput,
  McpAppFrameRegisterResult,
  McpAppFrameUnregisterInput,
} from './mcp-app-frame'
import type {
  McpConfigurationView,
  McpServerInspection,
  McpServerStatusView,
} from './mcp-configuration'
import type {
  McpAddServerRequest,
  McpConfigurationScopeRequest,
  McpImportApplyRequest,
  McpImportApplyResultView,
  McpImportPreviewRequest,
  McpImportPreviewView,
  McpInstallCatalogServerRequest,
  McpRemoveServerRequest,
  McpServerNameRequest,
  McpSessionRequest,
  McpSetServerEnabledRequest,
  McpSetServerExposureRequest,
  McpSetSessionEnabledRequest,
  McpSignInResultView,
} from './mcp-configuration-operations'
import type {
  McpRegistryInstallRequest,
  McpRegistryInstallResultView,
  McpRegistrySearchRequest,
  McpRegistrySearchResultView,
  McpRegistryServerRequest,
  McpRegistryServerView,
} from './mcp-registry'

export interface IpcMcpInvokeChannelMap {
  'mcp:get-configuration': {
    args: [input: McpConfigurationScopeRequest]
    return: McpConfigurationView
  }
  'mcp:set-server-enabled': {
    args: [input: McpSetServerEnabledRequest]
    return: McpConfigurationView
  }
  'mcp:set-server-exposure': {
    args: [input: McpSetServerExposureRequest]
    return: McpConfigurationView
  }
  'mcp:add-server': { args: [input: McpAddServerRequest]; return: McpConfigurationView }
  'mcp:remove-server': { args: [input: McpRemoveServerRequest]; return: McpConfigurationView }
  'mcp:install-catalog-server': {
    args: [input: McpInstallCatalogServerRequest]
    return: McpConfigurationView
  }
  'mcp:inspect-server': { args: [input: McpServerNameRequest]; return: McpServerInspection }
  'mcp:get-server-statuses': {
    args: [input: McpConfigurationScopeRequest]
    return: readonly McpServerStatusView[]
  }
  'mcp:sign-in': { args: [input: McpServerNameRequest]; return: McpSignInResultView }
  'mcp:sign-out': { args: [input: McpServerNameRequest]; return: undefined }
  /** Whether the Session's Runs use MCP servers; true unless the Session was switched off. */
  'mcp:get-session-enabled': { args: [input: McpSessionRequest]; return: boolean }
  'mcp:set-session-enabled': { args: [input: McpSetSessionEnabledRequest]; return: boolean }
  'mcp:preview-imports': { args: [input: McpImportPreviewRequest]; return: McpImportPreviewView }
  'mcp:apply-imports': { args: [input: McpImportApplyRequest]; return: McpImportApplyResultView }
  'mcp:search-registry': {
    args: [input: McpRegistrySearchRequest]
    return: McpRegistrySearchResultView
  }
  'mcp:get-registry-server': {
    args: [input: McpRegistryServerRequest]
    return: McpRegistryServerView
  }
  'mcp:install-registry-server': {
    args: [input: McpRegistryInstallRequest]
    return: McpRegistryInstallResultView
  }
  'mcp:list-secrets': { args: []; return: readonly McpSecretSummary[] }
  'mcp:set-secret': { args: [input: McpSetSecretInput]; return: readonly McpSecretSummary[] }
  'mcp:remove-secret': {
    args: [input: McpRemoveSecretInput]
    return: readonly McpSecretSummary[]
  }
  'mcp:read-resource': { args: [input: McpReadResourceInput]; return: McpResourceResult }
  'mcp:list-app-catalog': { args: [input: McpAppCatalogInput]; return: McpAppCatalogResult }
  'mcp:call-app-tool': {
    args: [input: McpAppToolCallInput]
    return: McpAppToolCallResult
  }
  'mcp:register-app-frame': {
    args: [input: McpAppFrameRegisterInput]
    return: McpAppFrameRegisterResult
  }
  'mcp:unregister-app-frame': { args: [input: McpAppFrameUnregisterInput]; return: undefined }
}
