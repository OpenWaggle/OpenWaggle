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
  getSessionMcpEnabled(input: McpSessionRequest): Promise<boolean>
  setSessionMcpEnabled(input: McpSetSessionEnabledRequest): Promise<boolean>
  previewMcpImports(input: McpImportPreviewRequest): Promise<McpImportPreviewView>
  applyMcpImports(input: McpImportApplyRequest): Promise<McpImportApplyResultView>
  searchMcpRegistry(input: McpRegistrySearchRequest): Promise<McpRegistrySearchResultView>
  getMcpRegistryServer(input: McpRegistryServerRequest): Promise<McpRegistryServerView>
  installMcpRegistryServer(input: McpRegistryInstallRequest): Promise<McpRegistryInstallResultView>
  listMcpSecrets(): Promise<readonly McpSecretSummary[]>
  setMcpSecret(input: McpSetSecretInput): Promise<readonly McpSecretSummary[]>
  removeMcpSecret(input: McpRemoveSecretInput): Promise<readonly McpSecretSummary[]>
  readMcpResource(input: McpReadResourceInput): Promise<McpResourceResult>
  listMcpAppCatalog(input: McpAppCatalogInput): Promise<McpAppCatalogResult>
  callMcpAppTool(input: McpAppToolCallInput): Promise<McpAppToolCallResult>
}
