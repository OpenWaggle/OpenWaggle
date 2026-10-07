import type {
  McpAppToolCallInput,
  McpAppToolCallResult,
  McpReadResourceInput,
  McpRemoveSecretInput,
  McpResourceResult,
  McpSecretSummary,
  McpSetSecretInput,
} from './mcp'

export interface OpenWaggleMcpApi {
  listMcpSecrets(): Promise<readonly McpSecretSummary[]>
  setMcpSecret(input: McpSetSecretInput): Promise<readonly McpSecretSummary[]>
  removeMcpSecret(input: McpRemoveSecretInput): Promise<readonly McpSecretSummary[]>
  readMcpResource(input: McpReadResourceInput): Promise<McpResourceResult>
  callMcpAppTool(input: McpAppToolCallInput): Promise<McpAppToolCallResult>
}
