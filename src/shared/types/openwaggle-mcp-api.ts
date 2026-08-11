import type {
  McpAddServerInput,
  McpAppToolCallInput,
  McpAppToolCallResult,
  McpAuthorizeServerInput,
  McpAuthorizeServerResult,
  McpCapabilityCatalog,
  McpDoctorInput,
  McpDoctorResult,
  McpEventRecord,
  McpEventSubscriptionState,
  McpGetPromptInput,
  McpGetSettingsInput,
  McpImportApplyInput,
  McpImportApplyResult,
  McpImportPreview,
  McpImportPreviewInput,
  McpListCapabilitiesInput,
  McpPromptResult,
  McpReadResourceInput,
  McpRemoteSkillReview,
  McpRemoveSecretInput,
  McpRemoveServerInput,
  McpResourceResult,
  McpReviewRemoteSkillInput,
  McpSecretSummary,
  McpSetEventSubscriptionInput,
  McpSetScopeStateInput,
  McpSetSecretInput,
  McpSetServerEnabledInput,
  McpSetServerTrustInput,
  McpSettingsView,
  McpTaskOperationInput,
  McpTaskRecord,
  McpWriteSourceConfigInput,
} from './mcp'

export interface OpenWaggleMcpApi {
  getMcpSettings(input?: McpGetSettingsInput): Promise<McpSettingsView>
  setMcpScopeState(input: McpSetScopeStateInput): Promise<McpSettingsView>
  setMcpServerEnabled(input: McpSetServerEnabledInput): Promise<McpSettingsView>
  setMcpServerTrust(input: McpSetServerTrustInput): Promise<McpSettingsView>
  writeMcpSourceConfig(input: McpWriteSourceConfigInput): Promise<McpSettingsView>
  removeMcpServer(input: McpRemoveServerInput): Promise<McpSettingsView>
  authorizeMcpServer(input: McpAuthorizeServerInput): Promise<McpAuthorizeServerResult>
  logoutMcpServer(input: McpAuthorizeServerInput): Promise<{ loggedOut: true }>
  addMcpServer(input: McpAddServerInput): Promise<McpSettingsView>
  previewMcpImports(input: McpImportPreviewInput): Promise<McpImportPreview>
  applyMcpImports(input: McpImportApplyInput): Promise<McpImportApplyResult>
  doctorMcp(input?: McpDoctorInput): Promise<McpDoctorResult>
  listMcpSecrets(): Promise<readonly McpSecretSummary[]>
  setMcpSecret(input: McpSetSecretInput): Promise<readonly McpSecretSummary[]>
  removeMcpSecret(input: McpRemoveSecretInput): Promise<readonly McpSecretSummary[]>
  listMcpCapabilities(input: McpListCapabilitiesInput): Promise<McpCapabilityCatalog>
  getMcpPrompt(input: McpGetPromptInput): Promise<McpPromptResult>
  readMcpResource(input: McpReadResourceInput): Promise<McpResourceResult>
  reviewMcpRemoteSkill(input: McpReviewRemoteSkillInput): Promise<McpRemoteSkillReview>
  operateMcpTask(input: McpTaskOperationInput): Promise<readonly McpTaskRecord[]>
  callMcpAppTool(input: McpAppToolCallInput): Promise<McpAppToolCallResult>
  setMcpEventSubscription(input: McpSetEventSubscriptionInput): Promise<McpEventSubscriptionState>
  listMcpEvents(input?: McpGetSettingsInput): Promise<readonly McpEventRecord[]>
  listMcpEventSubscriptions(
    input?: McpGetSettingsInput,
  ): Promise<readonly McpEventSubscriptionState[]>
}
