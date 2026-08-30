import type { AgentSendPayload, AgentSendReport } from './agent'
import type {
  AgentDefinitionManagementCommand,
  AgentDefinitionManagementOutcome,
} from './agent-definition-management'
import type {
  AgentLoopInteractionResponseInput,
  AgentLoopInteractionSubmitResult,
} from './agent-loop-interaction'
import type { SessionId } from './brand'
import type { CliShimMutationResult, CliShimStatus } from './cli-shim'
import type { ContextCompactionResult, ContextUsageSnapshot } from './context-usage'
import type {
  DocsDiscoveryView,
  DocsListInput,
  DocsResolveTopicInput,
  FirstPartyDocsTopicSummary,
} from './docs'
import type { ExtensionInvokeInput, ExtensionInvokeResult } from './extension-broker'
import type {
  ExtensionFrameRegisterInput,
  ExtensionFrameRegisterResult,
  ExtensionFrameUnregisterInput,
} from './extension-frame'
import type {
  ExtensionAcceptUpdateInput,
  ExtensionApplyPackageRemoveInput,
  ExtensionApplyPackageWriteInput,
  ExtensionApproveBuildInput,
  ExtensionContributionRegistryView,
  ExtensionListContributionsInput,
  ExtensionListPackagesInput,
  ExtensionManagerView,
  ExtensionPackageRemoveProposalView,
  ExtensionPackageWriteProposalView,
  ExtensionProposePackageRemoveInput,
  ExtensionProposePackageWriteInput,
  ExtensionReloadInput,
  ExtensionSetEnabledInput,
  ExtensionSetProjectDisabledInput,
  ExtensionSetTrustedInput,
} from './extensions'
import type { IpcSessionInvokeChannelMap } from './ipc-invoke-sessions'
import type { ProviderInfo, SupportedModelId } from './llm'
import type {
  LocalSessionProfileManagementResponse,
  LocalSessionProfileUiCommand,
} from './local-session-profile-management'
import type {
  ProjectPreferencesPayload,
  ProjectPreferencesUpdatePayload,
} from './openwaggle-api-project'
import type { SessionTreeFilterMode } from './session'
import type {
  SessionControlMutationRequest,
  SessionControlMutationResponse,
} from './session-control'
import type { SessionQueryRequest, SessionQueryResponse } from './session-query'
import type { Settings } from './settings'

// ─── IPC Channel Map ─────────────────────────────────────────
// Single source of truth for every IPC channel.
// Each entry defines: [channel name, args tuple, return type]

export interface IpcCoreInvokeChannelMap extends IpcSessionInvokeChannelMap {
  'agent-definitions:select-source': {
    args: []
    return: string | null
  }
  'agent-definitions:manage': {
    args: [command: AgentDefinitionManagementCommand]
    return: AgentDefinitionManagementOutcome
  }
  'access-profiles:manage': {
    args: [command: LocalSessionProfileUiCommand]
    return: LocalSessionProfileManagementResponse
  }
  'session-control:mutate': {
    args: [request: SessionControlMutationRequest]
    return: SessionControlMutationResponse
  }
  'session-control:query': {
    args: [request: SessionQueryRequest]
    return: SessionQueryResponse
  }
  'agent:send-message': {
    args: [sessionId: SessionId, payload: AgentSendPayload, model: SupportedModelId]
    return: AgentSendReport
  }
  'agent:cancel': {
    args: [sessionId?: SessionId]
    return: undefined
  }
  'agent:respond-interaction': {
    args: [input: AgentLoopInteractionResponseInput]
    return: AgentLoopInteractionSubmitResult
  }
  'agent:get-context-usage': {
    args: [sessionId: SessionId, model: SupportedModelId]
    return: ContextUsageSnapshot | null
  }
  'agent:compact-session': {
    args: [sessionId: SessionId, model: SupportedModelId, customInstructions?: string]
    return: ContextCompactionResult
  }
  'settings:get': {
    args: []
    return: Settings
  }
  'settings:update': {
    args: [settings: Partial<Settings>]
    return: { ok: true } | { ok: false; error: string }
  }
  'settings:set-enabled-models': {
    args: [models: string[]]
    return: undefined
  }
  'cli-shim:get-status': {
    args: []
    return: CliShimStatus
  }
  'cli-shim:install': {
    args: []
    return: CliShimMutationResult
  }
  'cli-shim:remove': {
    args: []
    return: CliShimMutationResult
  }
  'pi-settings:get-tree-filter-mode': {
    args: [projectPath?: string | null]
    return: SessionTreeFilterMode
  }
  'pi-settings:set-tree-filter-mode': {
    args: [mode: SessionTreeFilterMode, projectPath?: string | null]
    return: undefined
  }
  'pi-settings:get-branch-summary-skip-prompt': {
    args: [projectPath?: string | null]
    return: boolean
  }
  'settings:test-api-key': {
    args: [provider: string, apiKey: string, projectPath?: string | null]
    return: { success: boolean; error?: string }
  }
  'extensions:list-packages': {
    args: [input?: ExtensionListPackagesInput]
    return: ExtensionManagerView
  }
  'extensions:list-contributions': {
    args: [input?: ExtensionListContributionsInput]
    return: ExtensionContributionRegistryView
  }
  'extensions:propose-package-write': {
    args: [input: ExtensionProposePackageWriteInput]
    return: ExtensionPackageWriteProposalView
  }
  'extensions:apply-package-write': {
    args: [input: ExtensionApplyPackageWriteInput]
    return: ExtensionManagerView
  }
  'extensions:propose-package-remove': {
    args: [input: ExtensionProposePackageRemoveInput]
    return: ExtensionPackageRemoveProposalView
  }
  'extensions:apply-package-remove': {
    args: [input: ExtensionApplyPackageRemoveInput]
    return: ExtensionManagerView
  }
  'extensions:invoke': {
    args: [input: ExtensionInvokeInput]
    return: ExtensionInvokeResult
  }
  'extensions:register-frame': {
    args: [input: ExtensionFrameRegisterInput]
    return: ExtensionFrameRegisterResult
  }
  'extensions:unregister-frame': {
    args: [input: ExtensionFrameUnregisterInput]
    return: undefined
  }
  'extensions:set-trusted': {
    args: [input: ExtensionSetTrustedInput]
    return: ExtensionManagerView
  }
  'extensions:set-enabled': {
    args: [input: ExtensionSetEnabledInput]
    return: ExtensionManagerView
  }
  'extensions:set-project-disabled': {
    args: [input: ExtensionSetProjectDisabledInput]
    return: ExtensionManagerView
  }
  'extensions:accept-update': {
    args: [input: ExtensionAcceptUpdateInput]
    return: ExtensionManagerView
  }
  'extensions:approve-build': {
    args: [input: ExtensionApproveBuildInput]
    return: ExtensionManagerView
  }
  'extensions:reload': {
    args: [input: ExtensionReloadInput]
    return: ExtensionManagerView
  }
  'docs:discover': {
    args: [input?: DocsListInput]
    return: DocsDiscoveryView
  }
  'docs:resolve-topic': {
    args: [input: DocsResolveTopicInput]
    return: FirstPartyDocsTopicSummary | null
  }
  'project:select-folder': {
    args: []
    return: string | null
  }
  'project-config:get-preferences': {
    args: [projectPath: string]
    return: ProjectPreferencesPayload | null
  }
  'project-config:set-preferences': {
    args: [projectPath: string, preferences: ProjectPreferencesUpdatePayload]
    return: undefined
  }
  'providers:get-models': {
    args: [projectPath?: string | null]
    return: ProviderInfo[]
  }
}
