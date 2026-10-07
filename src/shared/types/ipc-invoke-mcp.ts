import type {
  McpAppToolCallInput,
  McpAppToolCallResult,
  McpReadResourceInput,
  McpRemoveSecretInput,
  McpResourceResult,
  McpSecretSummary,
  McpSetSecretInput,
} from './mcp'
import type { McpConfigurationView, McpServerInspection } from './mcp-configuration'
import type {
  McpAddServerRequest,
  McpConfigurationScopeRequest,
  McpImportApplyRequest,
  McpImportApplyResultView,
  McpImportPreviewRequest,
  McpImportPreviewView,
  McpInstallCatalogServerRequest,
  McpServerNameRequest,
  McpSetServerEnabledRequest,
  McpSetServerExposureRequest,
  McpSignInResultView,
} from './mcp-configuration-operations'

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
  'mcp:remove-server': { args: [input: McpServerNameRequest]; return: McpConfigurationView }
  'mcp:install-catalog-server': {
    args: [input: McpInstallCatalogServerRequest]
    return: McpConfigurationView
  }
  'mcp:inspect-server': { args: [input: McpServerNameRequest]; return: McpServerInspection }
  'mcp:sign-in': { args: [input: McpServerNameRequest]; return: McpSignInResultView }
  'mcp:sign-out': { args: [input: McpServerNameRequest]; return: undefined }
  'mcp:preview-imports': { args: [input: McpImportPreviewRequest]; return: McpImportPreviewView }
  'mcp:apply-imports': { args: [input: McpImportApplyRequest]; return: McpImportApplyResultView }
  'mcp:list-secrets': { args: []; return: readonly McpSecretSummary[] }
  'mcp:set-secret': { args: [input: McpSetSecretInput]; return: readonly McpSecretSummary[] }
  'mcp:remove-secret': {
    args: [input: McpRemoveSecretInput]
    return: readonly McpSecretSummary[]
  }
  'mcp:read-resource': { args: [input: McpReadResourceInput]; return: McpResourceResult }
  'mcp:call-app-tool': {
    args: [input: McpAppToolCallInput]
    return: McpAppToolCallResult
  }
}
