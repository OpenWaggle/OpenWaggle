import type {
  McpAppToolCallInput,
  McpAppToolCallResult,
  McpReadResourceInput,
  McpRemoveSecretInput,
  McpResourceResult,
  McpSecretSummary,
  McpSetSecretInput,
} from './mcp'

export interface IpcMcpInvokeChannelMap {
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
