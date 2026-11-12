import type { IpcInvokeMethod } from './ipc-api-methods'

export interface OpenWaggleSessionControlApi {
  getCliShimStatus: IpcInvokeMethod<'cli-shim:get-status'>
  installCliShim: IpcInvokeMethod<'cli-shim:install'>
  removeCliShim: IpcInvokeMethod<'cli-shim:remove'>
  selectAgentDefinitionSource: IpcInvokeMethod<'agent-definitions:select-source'>
  manageAgentDefinitions: IpcInvokeMethod<'agent-definitions:manage'>
  listAgentDefinitionDisplay: IpcInvokeMethod<'agent-definitions:list-display'>
  getAgentDefinitionPreview: IpcInvokeMethod<'agent-definitions:get-preview'>
  setAgentDefinitionEnabled: IpcInvokeMethod<'agent-definitions:set-enabled'>
  manageAccessProfiles: IpcInvokeMethod<'access-profiles:manage'>
  /** Execute a GUI-authored mutation through the same durable Session Control used by CLI/MCP. */
  mutateSessionControl: IpcInvokeMethod<'session-control:mutate'>
  /** Read the canonical Session Host projection used by GUI/CLI/MCP. */
  querySessionControl: IpcInvokeMethod<'session-control:query'>
  /**
   * Binds a Follow-up edit hold this user already holds to the calling window, so that window
   * renews it and releases it when it closes (ADR 0044). `false` when the hold is gone.
   */
  adoptFollowUpEdit: IpcInvokeMethod<'session-control:adopt-follow-up-edit'>
}
