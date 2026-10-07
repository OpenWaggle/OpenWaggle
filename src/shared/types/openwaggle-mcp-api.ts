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
  McpServerRequest,
  McpSetServerEnabledRequest,
  McpSetServerExposureRequest,
  McpSignInResultView,
} from './mcp-configuration-operations'

export interface OpenWaggleMcpApi {
  getMcpConfiguration(input: McpConfigurationScopeRequest): Promise<McpConfigurationView>
  setMcpServerEnabled(input: McpSetServerEnabledRequest): Promise<McpConfigurationView>
  setMcpServerExposure(input: McpSetServerExposureRequest): Promise<McpConfigurationView>
  addMcpServer(input: McpAddServerRequest): Promise<McpConfigurationView>
  removeMcpServer(input: McpServerRequest): Promise<McpConfigurationView>
  installMcpCatalogServer(input: McpInstallCatalogServerRequest): Promise<McpConfigurationView>
  inspectMcpServer(input: McpServerRequest): Promise<McpServerInspection>
  signInMcpServer(input: McpServerRequest): Promise<McpSignInResultView>
  signOutMcpServer(input: McpServerRequest): Promise<void>
  previewMcpImports(input: McpImportPreviewRequest): Promise<McpImportPreviewView>
  applyMcpImports(input: McpImportApplyRequest): Promise<McpImportApplyResultView>
  listMcpSecrets(): Promise<readonly McpSecretSummary[]>
  setMcpSecret(input: McpSetSecretInput): Promise<readonly McpSecretSummary[]>
  removeMcpSecret(input: McpRemoveSecretInput): Promise<readonly McpSecretSummary[]>
  readMcpResource(input: McpReadResourceInput): Promise<McpResourceResult>
  callMcpAppTool(input: McpAppToolCallInput): Promise<McpAppToolCallResult>
}
