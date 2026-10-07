import type {
  McpAppToolCallInput,
  McpAppToolCallResult,
  McpReadResourceInput,
  McpRemoveSecretInput,
  McpResourceResult,
  McpSecretSummary,
  McpSetSecretInput,
} from './mcp'
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
  McpServerNameRequest,
  McpSetServerEnabledRequest,
  McpSetServerExposureRequest,
  McpSignInResultView,
} from './mcp-configuration-operations'

export interface OpenWaggleMcpApi {
  getMcpConfiguration(input: McpConfigurationScopeRequest): Promise<McpConfigurationView>
  setMcpServerEnabled(input: McpSetServerEnabledRequest): Promise<McpConfigurationView>
  setMcpServerExposure(input: McpSetServerExposureRequest): Promise<McpConfigurationView>
  addMcpServer(input: McpAddServerRequest): Promise<McpConfigurationView>
  removeMcpServer(input: McpServerNameRequest): Promise<McpConfigurationView>
  installMcpCatalogServer(input: McpInstallCatalogServerRequest): Promise<McpConfigurationView>
  inspectMcpServer(input: McpServerNameRequest): Promise<McpServerInspection>
  getMcpServerStatuses(input: McpConfigurationScopeRequest): Promise<readonly McpServerStatusView[]>
  signInMcpServer(input: McpServerNameRequest): Promise<McpSignInResultView>
  signOutMcpServer(input: McpServerNameRequest): Promise<void>
  previewMcpImports(input: McpImportPreviewRequest): Promise<McpImportPreviewView>
  applyMcpImports(input: McpImportApplyRequest): Promise<McpImportApplyResultView>
  listMcpSecrets(): Promise<readonly McpSecretSummary[]>
  setMcpSecret(input: McpSetSecretInput): Promise<readonly McpSecretSummary[]>
  removeMcpSecret(input: McpRemoveSecretInput): Promise<readonly McpSecretSummary[]>
  readMcpResource(input: McpReadResourceInput): Promise<McpResourceResult>
  callMcpAppTool(input: McpAppToolCallInput): Promise<McpAppToolCallResult>
}
