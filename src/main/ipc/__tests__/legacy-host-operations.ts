/**
 * The Session Host operations behind each Host-backed IPC channel, as the desktop window's IPC
 * registration used to run them when no Host answered. The window no longer runs them (A-F5): it
 * relays every Host-backed channel. These tests still cover the operations through the IPC
 * harnesses they were written against, so `withLegacyHostOperation` restores that dispatch in tests
 * only.
 */

import type { SessionId } from '@shared/types/brand'
import type { HostBackedGuiChannel } from '@shared/types/host-ui-protocol'
import type { SupportedModelId } from '@shared/types/llm'
import { manageProjectActions } from '../../application/action-management'
import {
  getAgentDefinitionPreviewOperation,
  listAgentDefinitionDisplayOperation,
  setAgentDefinitionEnabledOperation,
} from '../../application/agent-definition-display-operations'
import { getAgentContextUsage } from '../../application/agent-session-service'
import { manageHostUiAgentDefinitions } from '../../application/host-ui-agent-definition-operation'
import {
  listHostUiActiveActivities,
  listHostUiAgentExtensionCommands,
} from '../../application/host-ui-agent-operation'
import {
  discoverHostUiDocs,
  discoverHostUiDocsWith,
} from '../../application/host-ui-docs-operation'
import {
  acceptHostUiExtensionUpdate,
  applyHostUiExtensionPackageRemove,
  applyHostUiExtensionPackageWrite,
  approveHostUiExtensionBuild,
  invokeHostUiExtension,
  listHostUiExtensionContributions,
  listHostUiExtensionContributionsWith,
  listHostUiExtensionPackages,
  proposeHostUiExtensionPackageRemove,
  proposeHostUiExtensionPackageWrite,
  reloadHostUiExtension,
  setHostUiExtensionEnabled,
  setHostUiExtensionProjectDisabled,
  setHostUiExtensionTrusted,
} from '../../application/host-ui-extension-operations'
import { getHostUiProviderModels } from '../../application/host-ui-provider-operation'
import {
  dispatchHostBackedSessionGuiOperation,
  isHostBackedSessionGuiChannel,
} from '../../application/host-ui-session-operation-dispatcher'
import {
  createHostUiWorktree,
  removeHostUiWorktree,
} from '../../application/host-ui-worktree-operation'
import {
  callMcpAppToolOperation,
  listMcpAppCatalogOperation,
  readMcpResourceOperation,
} from '../../application/mcp-app-operations'
import {
  addMcpServerOperation,
  applyMcpImportsOperation,
  getMcpConfigurationOperation,
  getMcpServerStatusesOperation,
  inspectMcpServerOperation,
  installMcpCatalogServerOperation,
  previewMcpImportsOperation,
  removeMcpServerOperation,
  setMcpServerEnabledOperation,
  setMcpServerExposureOperation,
  signInMcpServerOperation,
  signOutMcpServerOperation,
} from '../../application/mcp-configuration-operations'
import {
  getMcpRegistryServerOperation,
  installMcpRegistryServerOperation,
  searchMcpRegistryOperation,
} from '../../application/mcp-registry-operations'
import {
  listMcpSecretsOperation,
  removeMcpSecretOperation,
  setMcpSecretOperation,
} from '../../application/mcp-secret-operations'
import {
  getSessionMcpEnabledOperation,
  setSessionMcpEnabledOperation,
} from '../../application/mcp-session-switch-operations'
import {
  grantProjectAuthorizationOperation,
  revokeProjectAuthorizationOperation,
} from '../../application/project-authorization-grant-operation'
import { removeProjectModelOperation } from '../../application/project-model-removal-operation'
import {
  getProjectPreferencesOperation,
  setProjectPreferencesOperation,
} from '../../application/project-preferences-operation'
import {
  getSettingsOperation,
  setEnabledModelsOperation,
  testApiKeyOperation,
  updateSettingsOperation,
} from '../../application/settings-operations'
import {
  getSkillPreviewOperation,
  listSkillsOperation,
  setSkillEnabledOperation,
} from '../../application/skill-operations'
import { loadSessionChangeRequestPanel } from '../../services/source-control/session-change-requests'
import { decodeSessionRequestArguments } from '../../services/source-control/session-request-arguments'
import type {
  LegacyHostOperation,
  LegacyHostOperationDependencies,
  LegacyHostOperationTable,
} from './legacy-host-operation-types'
import { legacySessionResourceOperations } from './legacy-host-session-resource-operations'

export type { LegacyHostOperationDependencies } from './legacy-host-operation-types'

export function legacyHostOperations(
  dependencies: LegacyHostOperationDependencies = {},
): LegacyHostOperationTable {
  return {
    ...legacySessionResourceOperations,
    'agent-definitions:list-display': (_event, projectPath) =>
      listAgentDefinitionDisplayOperation(projectPath),
    'agent-definitions:get-preview': (_event, projectPath, name) =>
      getAgentDefinitionPreviewOperation(projectPath, name),
    'agent-definitions:set-enabled': (_event, projectPath, name, enabled) =>
      setAgentDefinitionEnabledOperation(projectPath, name, enabled),
    'agent-definitions:manage': (event, command) =>
      manageHostUiAgentDefinitions({ senderId: event.sender.id, command }),
    'agent:list-active-runs': () => listHostUiActiveActivities(),
    'agent:get-context-usage': (_event, sessionId: SessionId, model: SupportedModelId) =>
      getAgentContextUsage({ sessionId, model }),
    'agent:list-extension-commands': (
      _event,
      sessionId: SessionId | null,
      model: SupportedModelId,
      projectPath?: string,
    ) => listHostUiAgentExtensionCommands(sessionId, model, projectPath),
    'docs:discover': (_event, input?: unknown) =>
      dependencies.listDocs
        ? discoverHostUiDocsWith(input, dependencies.listDocs)
        : discoverHostUiDocs(input),
    'extensions:invoke': (_event, input: unknown, rawInvocationBinding?: unknown) =>
      invokeHostUiExtension(input, rawInvocationBinding),
    'extensions:list-packages': (_event, input?: unknown) => listHostUiExtensionPackages(input),
    'extensions:list-contributions': (_event, input?: unknown) =>
      dependencies.listExtensionContributionsView
        ? listHostUiExtensionContributionsWith(input, dependencies.listExtensionContributionsView)
        : listHostUiExtensionContributions(input),
    'extensions:propose-package-write': (_event, input: unknown) =>
      proposeHostUiExtensionPackageWrite(input),
    'extensions:apply-package-write': (_event, input: unknown) =>
      applyHostUiExtensionPackageWrite(input),
    'extensions:propose-package-remove': (_event, input: unknown) =>
      proposeHostUiExtensionPackageRemove(input),
    'extensions:apply-package-remove': (_event, input: unknown) =>
      applyHostUiExtensionPackageRemove(input),
    'extensions:set-trusted': (_event, input: unknown) => setHostUiExtensionTrusted(input),
    'extensions:set-enabled': (_event, input: unknown) => setHostUiExtensionEnabled(input),
    'extensions:set-project-disabled': (_event, input: unknown) =>
      setHostUiExtensionProjectDisabled(input),
    'extensions:accept-update': (_event, input: unknown) => acceptHostUiExtensionUpdate(input),
    'extensions:approve-build': (_event, input: unknown) => approveHostUiExtensionBuild(input),
    'extensions:reload': (_event, input: unknown) => reloadHostUiExtension(input),
    'git:change-request:panel': (_event, rawSessionId, rawPath, rawUrl) => {
      const { sessionId, workingPath, requestUrl } = decodeSessionRequestArguments(
        rawSessionId,
        rawPath,
        rawUrl,
      )
      return loadSessionChangeRequestPanel(sessionId, workingPath, requestUrl)
    },
    'git:worktrees:create': (_event, rawPath: unknown, rawPayload: unknown) =>
      createHostUiWorktree(rawPath, rawPayload),
    'git:worktrees:remove': (_event, rawPath: unknown, rawPayload: unknown) =>
      removeHostUiWorktree(rawPath, rawPayload),
    'mcp:get-configuration': (_event, raw: unknown) => getMcpConfigurationOperation(raw),
    'mcp:set-server-enabled': (_event, raw: unknown) => setMcpServerEnabledOperation(raw),
    'mcp:set-server-exposure': (_event, raw: unknown) => setMcpServerExposureOperation(raw),
    'mcp:add-server': (_event, raw: unknown) => addMcpServerOperation(raw),
    'mcp:remove-server': (_event, raw: unknown) => removeMcpServerOperation(raw),
    'mcp:install-catalog-server': (_event, raw: unknown) => installMcpCatalogServerOperation(raw),
    'mcp:inspect-server': (_event, raw: unknown) => inspectMcpServerOperation(raw),
    'mcp:get-server-statuses': (_event, raw: unknown) => getMcpServerStatusesOperation(raw),
    'mcp:sign-in': (_event, raw: unknown) => signInMcpServerOperation(raw),
    'mcp:sign-out': (_event, raw: unknown) => signOutMcpServerOperation(raw),
    'mcp:get-session-enabled': (_event, raw: unknown) => getSessionMcpEnabledOperation(raw),
    'mcp:set-session-enabled': (_event, raw: unknown) => setSessionMcpEnabledOperation(raw),
    'mcp:preview-imports': (_event, raw: unknown) => previewMcpImportsOperation(raw),
    'mcp:apply-imports': (_event, raw: unknown) => applyMcpImportsOperation(raw),
    'mcp:search-registry': (_event, raw: unknown) => searchMcpRegistryOperation(raw),
    'mcp:get-registry-server': (_event, raw: unknown) => getMcpRegistryServerOperation(raw),
    'mcp:install-registry-server': (_event, raw: unknown) => installMcpRegistryServerOperation(raw),
    'mcp:list-secrets': () => listMcpSecretsOperation(),
    'mcp:set-secret': (_event, raw: unknown) => setMcpSecretOperation(raw),
    'mcp:remove-secret': (_event, raw: unknown) => removeMcpSecretOperation(raw),
    'mcp:read-resource': (_event, raw: unknown) => readMcpResourceOperation(raw),
    'mcp:list-app-catalog': (_event, raw: unknown) => listMcpAppCatalogOperation(raw),
    'mcp:call-app-tool': (_event, raw: unknown) => callMcpAppToolOperation(raw),
    'project-actions:manage': (_event, request) => manageProjectActions(request),
    'project-config:get-preferences': (_event, projectPath: string) =>
      getProjectPreferencesOperation(projectPath),
    'project-config:set-preferences': (_event, projectPath: string, preferences) =>
      setProjectPreferencesOperation(projectPath, preferences),
    'project-config:remove-project-model': (
      _event,
      projectPath: string,
      remainingProjectPaths?: readonly string[],
    ) => removeProjectModelOperation(projectPath, remainingProjectPaths),
    'authorization-grants:grant': (_event, projectPath: string, key: unknown) =>
      grantProjectAuthorizationOperation(projectPath, key),
    'authorization-grants:revoke': (_event, projectPath: string, key: unknown) =>
      revokeProjectAuthorizationOperation(projectPath, key),
    'providers:get-models': (_event, projectPath?: string | null) =>
      getHostUiProviderModels(projectPath),
    'settings:get': () => getSettingsOperation(),
    'settings:update': (_event, raw: unknown) => updateSettingsOperation(raw),
    'settings:set-enabled-models': (_event, models: unknown) => setEnabledModelsOperation(models),
    'settings:test-api-key': (
      _event,
      provider: string,
      apiKey: string,
      projectPath?: string | null,
    ) => testApiKeyOperation(provider, apiKey, projectPath),
    'skills:list': (_event, rawProjectPath: string) => listSkillsOperation(rawProjectPath),
    'skills:set-enabled': (_event, rawProjectPath: string, rawSkillId: string, enabled: boolean) =>
      setSkillEnabledOperation(rawProjectPath, rawSkillId, enabled),
    'skills:get-preview': (_event, rawProjectPath: string, rawSkillId: string) =>
      getSkillPreviewOperation(rawProjectPath, rawSkillId),
  } satisfies LegacyHostOperationTable
}

let configuredDependencies: LegacyHostOperationDependencies = {}

/** The dependencies a test passed to its handler registration, for the operations it reaches. */
export function setLegacyHostOperationDependencies(dependencies: LegacyHostOperationDependencies) {
  configuredDependencies = dependencies
}

/** The operation a Host-backed channel ran in the window before A-F5. */
export function legacyHostOperation<C extends HostBackedGuiChannel>(
  channel: C,
): LegacyHostOperation<C> {
  const operation = legacyHostOperations(configuredDependencies)[channel]
  if (!operation && isHostBackedSessionGuiChannel(channel)) {
    // Every other `sessions:*` channel ran the Host's own Session operation.
    return (_event, ...args) => dispatchHostBackedSessionGuiOperation(channel, args)
  }
  if (!operation) throw new Error(`No legacy Host operation for ${channel}`)
  return operation
}

/**
 * For a test that mocks typed-ipc: records each Host-backed registration with the operation the
 * window ran for it before A-F5, where the test reads the handler it registered.
 */
export function withLegacyHostOperation(record: unknown) {
  if (typeof record !== 'function') throw new Error('Expected a registration recorder.')
  return (channel: HostBackedGuiChannel, ...rest: readonly unknown[]) => {
    Reflect.apply(record, undefined, [channel, legacyHostOperation(channel), ...rest])
  }
}
