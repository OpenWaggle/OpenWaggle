import type { IpcInvokeMethod } from './ipc-api-methods'

export interface OpenWaggleMcpApi {
  getMcpConfiguration: IpcInvokeMethod<'mcp:get-configuration'>
  setMcpServerEnabled: IpcInvokeMethod<'mcp:set-server-enabled'>
  setMcpServerExposure: IpcInvokeMethod<'mcp:set-server-exposure'>
  addMcpServer: IpcInvokeMethod<'mcp:add-server'>
  removeMcpServer: IpcInvokeMethod<'mcp:remove-server'>
  installMcpCatalogServer: IpcInvokeMethod<'mcp:install-catalog-server'>
  inspectMcpServer: IpcInvokeMethod<'mcp:inspect-server'>
  getMcpServerStatuses: IpcInvokeMethod<'mcp:get-server-statuses'>
  signInMcpServer: IpcInvokeMethod<'mcp:sign-in'>
  signOutMcpServer: IpcInvokeMethod<'mcp:sign-out'>
  getSessionMcpEnabled: IpcInvokeMethod<'mcp:get-session-enabled'>
  setSessionMcpEnabled: IpcInvokeMethod<'mcp:set-session-enabled'>
  previewMcpImports: IpcInvokeMethod<'mcp:preview-imports'>
  applyMcpImports: IpcInvokeMethod<'mcp:apply-imports'>
  searchMcpRegistry: IpcInvokeMethod<'mcp:search-registry'>
  getMcpRegistryServer: IpcInvokeMethod<'mcp:get-registry-server'>
  installMcpRegistryServer: IpcInvokeMethod<'mcp:install-registry-server'>
  listMcpSecrets: IpcInvokeMethod<'mcp:list-secrets'>
  setMcpSecret: IpcInvokeMethod<'mcp:set-secret'>
  removeMcpSecret: IpcInvokeMethod<'mcp:remove-secret'>
  readMcpResource: IpcInvokeMethod<'mcp:read-resource'>
  listMcpAppCatalog: IpcInvokeMethod<'mcp:list-app-catalog'>
  callMcpAppTool: IpcInvokeMethod<'mcp:call-app-tool'>
  /** Serves an App document under its own frame origin and policy (ADR 0053). */
  registerMcpAppFrame: IpcInvokeMethod<'mcp:register-app-frame'>
  unregisterMcpAppFrame: IpcInvokeMethod<'mcp:unregister-app-frame'>
}
