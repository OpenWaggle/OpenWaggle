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

export interface IpcMcpInvokeChannelMap {
  'mcp:get-settings': { args: [input?: McpGetSettingsInput]; return: McpSettingsView }
  'mcp:set-scope-state': { args: [input: McpSetScopeStateInput]; return: McpSettingsView }
  'mcp:set-server-enabled': {
    args: [input: McpSetServerEnabledInput]
    return: McpSettingsView
  }
  'mcp:write-source-config': {
    args: [input: McpWriteSourceConfigInput]
    return: McpSettingsView
  }
  'mcp:set-server-trust': { args: [input: McpSetServerTrustInput]; return: McpSettingsView }
  'mcp:remove-server': { args: [input: McpRemoveServerInput]; return: McpSettingsView }
  'mcp:authorize-server': {
    args: [input: McpAuthorizeServerInput]
    return: McpAuthorizeServerResult
  }
  'mcp:logout-server': { args: [input: McpAuthorizeServerInput]; return: { loggedOut: true } }
  'mcp:add-server': { args: [input: McpAddServerInput]; return: McpSettingsView }
  'mcp:preview-imports': { args: [input: McpImportPreviewInput]; return: McpImportPreview }
  'mcp:apply-imports': { args: [input: McpImportApplyInput]; return: McpImportApplyResult }
  'mcp:doctor': { args: [input?: McpDoctorInput]; return: McpDoctorResult }
  'mcp:list-secrets': { args: []; return: readonly McpSecretSummary[] }
  'mcp:set-secret': { args: [input: McpSetSecretInput]; return: readonly McpSecretSummary[] }
  'mcp:remove-secret': {
    args: [input: McpRemoveSecretInput]
    return: readonly McpSecretSummary[]
  }
  'mcp:list-capabilities': {
    args: [input: McpListCapabilitiesInput]
    return: McpCapabilityCatalog
  }
  'mcp:get-prompt': { args: [input: McpGetPromptInput]; return: McpPromptResult }
  'mcp:read-resource': { args: [input: McpReadResourceInput]; return: McpResourceResult }
  'mcp:review-remote-skill': {
    args: [input: McpReviewRemoteSkillInput]
    return: McpRemoteSkillReview
  }
  'mcp:operate-task': {
    args: [input: McpTaskOperationInput]
    return: readonly McpTaskRecord[]
  }
  'mcp:call-app-tool': {
    args: [input: McpAppToolCallInput]
    return: McpAppToolCallResult
  }
  'mcp:set-event-subscription': {
    args: [input: McpSetEventSubscriptionInput]
    return: McpEventSubscriptionState
  }
  'mcp:list-events': {
    args: [input?: McpGetSettingsInput]
    return: readonly McpEventRecord[]
  }
  'mcp:list-event-subscriptions': {
    args: [input?: McpGetSettingsInput]
    return: readonly McpEventSubscriptionState[]
  }
}
