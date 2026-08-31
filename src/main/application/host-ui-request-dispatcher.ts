import { match } from '@diegogbrisa/ts-match'
import { toHostUiJsonValue } from '@shared/host-ui-json'
import type { HostBackedGuiChannel, HostUiV1Request } from '@shared/types/host-ui-protocol'
import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type { LocalSessionCommandResult } from '@shared/types/local-session-protocol'
import { isRecord } from '@shared/utils/validation'
import * as Effect from 'effect/Effect'
import { manageHostUiAgentDefinitions } from './host-ui-agent-definition-operation'
import { getHostUiAgentContextUsage } from './host-ui-agent-operation'
import { discoverHostUiDocs } from './host-ui-docs-operation'
import {
  acceptHostUiExtensionUpdate,
  applyHostUiExtensionPackageRemove,
  applyHostUiExtensionPackageWrite,
  approveHostUiExtensionBuild,
  authorizeHostUiExtensionRuntimeModule,
  invokeHostUiExtension,
  listHostUiExtensionContributions,
  listHostUiExtensionPackages,
  proposeHostUiExtensionPackageRemove,
  proposeHostUiExtensionPackageWrite,
  reloadHostUiExtension,
  setHostUiExtensionEnabled,
  setHostUiExtensionProjectDisabled,
  setHostUiExtensionTrusted,
} from './host-ui-extension-operations'
import * as McpHostUi from './host-ui-mcp-operation-dispatcher'
import {
  hostUiStringValue,
  invalidHostUiInput,
  optionalHostUiProjectPath,
  requiredHostUiString,
  requireHostUiArgCount,
} from './host-ui-operation-validation'
import { getHostUiProviderModels } from './host-ui-provider-operation'
import { raceHostUiRequestWithSignal } from './host-ui-request-cancellation'
import {
  dispatchHostBackedSessionGuiOperation,
  isHostBackedSessionGuiChannel,
} from './host-ui-session-operation-dispatcher'
import { createHostUiWorktree, removeHostUiWorktree } from './host-ui-worktree-operation'
import { setProjectPreferencesOperation } from './project-preferences-operation'
import {
  getSettingsOperation,
  setEnabledModelsOperation,
  testApiKeyOperation,
  updateSettingsOperation,
} from './settings-operations'
import {
  getSkillPreviewOperation,
  listSkillsOperation,
  setSkillEnabledOperation,
} from './skill-operations'

const TWO_ARGUMENTS = 2
const THREE_ARGUMENTS = 3
const REMOTE_GUI_SENDER_ID = 0

function decodeAgentDefinitionInput(value: unknown) {
  if (!isRecord(value) || !Object.hasOwn(value, 'command')) {
    return { command: value, selectedSourcePaths: undefined }
  }
  if (
    !Array.isArray(value.selectedSourcePaths) ||
    !value.selectedSourcePaths.every((sourcePath) => typeof sourcePath === 'string')
  ) {
    return null
  }
  return { command: value.command, selectedSourcePaths: value.selectedSourcePaths }
}

function oneInput<A, E, R>(
  args: readonly unknown[],
  operation: (input: unknown) => Effect.Effect<A, E, R>,
) {
  return Effect.gen(function* () {
    yield* requireHostUiArgCount(args, 1)
    return yield* operation(args[0])
  })
}

function isSettingsChannel(
  channel: HostBackedGuiChannel,
): channel is Extract<HostBackedGuiChannel, `settings:${string}`> {
  return channel.startsWith('settings:')
}

function isExtensionChannel(
  channel: HostBackedGuiChannel,
): channel is Extract<HostBackedGuiChannel, `extensions:${string}`> {
  return channel.startsWith('extensions:')
}

function isSkillsChannel(
  channel: HostBackedGuiChannel,
): channel is Extract<HostBackedGuiChannel, `skills:${string}`> {
  return channel.startsWith('skills:')
}

function dispatchSettingsOperation(
  channel: Extract<HostBackedGuiChannel, `settings:${string}`>,
  args: readonly unknown[],
) {
  return match(channel)
    .with('settings:get', () =>
      Effect.gen(function* () {
        yield* requireHostUiArgCount(args, 0)
        return yield* getSettingsOperation()
      }),
    )
    .with('settings:update', () => oneInput(args, updateSettingsOperation))
    .with('settings:set-enabled-models', () => oneInput(args, setEnabledModelsOperation))
    .with('settings:test-api-key', () =>
      Effect.gen(function* () {
        yield* requireHostUiArgCount(args, TWO_ARGUMENTS, THREE_ARGUMENTS)
        const provider = yield* requiredHostUiString(args[0], 'Provider')
        const apiKey = yield* hostUiStringValue(args[1], 'API key')
        const projectPath = yield* optionalHostUiProjectPath(args[TWO_ARGUMENTS])
        return yield* testApiKeyOperation(provider, apiKey, projectPath)
      }),
    )
    .exhaustive()
}

function dispatchExtensionOperation(
  channel: Extract<HostBackedGuiChannel, `extensions:${string}`>,
  args: readonly unknown[],
) {
  return match(channel)
    .with('extensions:list-packages', () =>
      Effect.gen(function* () {
        yield* requireHostUiArgCount(args, 0, 1)
        return yield* listHostUiExtensionPackages(args[0])
      }),
    )
    .with('extensions:list-contributions', () =>
      Effect.gen(function* () {
        yield* requireHostUiArgCount(args, 0, 1)
        return yield* listHostUiExtensionContributions(args[0])
      }),
    )
    .with('extensions:propose-package-write', () =>
      oneInput(args, proposeHostUiExtensionPackageWrite),
    )
    .with('extensions:apply-package-write', () => oneInput(args, applyHostUiExtensionPackageWrite))
    .with('extensions:propose-package-remove', () =>
      oneInput(args, proposeHostUiExtensionPackageRemove),
    )
    .with('extensions:apply-package-remove', () =>
      oneInput(args, applyHostUiExtensionPackageRemove),
    )
    .with('extensions:invoke', () => oneInput(args, invokeHostUiExtension))
    .with('extensions:set-trusted', () => oneInput(args, setHostUiExtensionTrusted))
    .with('extensions:set-enabled', () => oneInput(args, setHostUiExtensionEnabled))
    .with('extensions:set-project-disabled', () =>
      oneInput(args, setHostUiExtensionProjectDisabled),
    )
    .with('extensions:accept-update', () => oneInput(args, acceptHostUiExtensionUpdate))
    .with('extensions:approve-build', () => oneInput(args, approveHostUiExtensionBuild))
    .with('extensions:reload', () => oneInput(args, reloadHostUiExtension))
    .with('extensions:authorize-runtime-module', () =>
      oneInput(args, authorizeHostUiExtensionRuntimeModule),
    )
    .exhaustive()
}

function dispatchSkillsOperation(
  channel: Extract<HostBackedGuiChannel, `skills:${string}`>,
  args: readonly unknown[],
) {
  return match(channel)
    .with('skills:list', () =>
      Effect.gen(function* () {
        yield* requireHostUiArgCount(args, 1)
        const projectPath = yield* requiredHostUiString(args[0], 'Project path')
        return yield* listSkillsOperation(projectPath)
      }),
    )
    .with('skills:set-enabled', () =>
      Effect.gen(function* () {
        yield* requireHostUiArgCount(args, THREE_ARGUMENTS)
        const projectPath = yield* requiredHostUiString(args[0], 'Project path')
        const skillId = yield* requiredHostUiString(args[1], 'Skill ID')
        if (typeof args[TWO_ARGUMENTS] !== 'boolean') {
          return yield* invalidHostUiInput('Skill enabled must be a boolean.')
        }
        return yield* setSkillEnabledOperation(projectPath, skillId, args[TWO_ARGUMENTS])
      }),
    )
    .with('skills:get-preview', () =>
      Effect.gen(function* () {
        yield* requireHostUiArgCount(args, TWO_ARGUMENTS)
        const projectPath = yield* requiredHostUiString(args[0], 'Project path')
        const skillId = yield* requiredHostUiString(args[1], 'Skill ID')
        return yield* getSkillPreviewOperation(projectPath, skillId)
      }),
    )
    .exhaustive()
}

function dispatchHostUiChannel(channel: HostBackedGuiChannel, args: readonly unknown[]) {
  if (isHostBackedSessionGuiChannel(channel))
    return dispatchHostBackedSessionGuiOperation(channel, args)
  if (McpHostUi.isMcpHostUiChannel(channel))
    return McpHostUi.dispatchMcpHostUiOperation(channel, args)
  if (isSettingsChannel(channel)) {
    return dispatchSettingsOperation(channel, args)
  }
  if (isExtensionChannel(channel)) {
    return dispatchExtensionOperation(channel, args)
  }
  if (isSkillsChannel(channel)) {
    return dispatchSkillsOperation(channel, args)
  }
  return match(channel)
    .with('agent:get-context-usage', () =>
      Effect.gen(function* () {
        yield* requireHostUiArgCount(args, TWO_ARGUMENTS)
        return yield* getHostUiAgentContextUsage(args[0], args[1])
      }),
    )
    .with('providers:get-models', () =>
      Effect.gen(function* () {
        yield* requireHostUiArgCount(args, 0, 1)
        return yield* getHostUiProviderModels(yield* optionalHostUiProjectPath(args[0]))
      }),
    )
    .with('project-config:set-preferences', () =>
      Effect.gen(function* () {
        yield* requireHostUiArgCount(args, TWO_ARGUMENTS)
        return yield* setProjectPreferencesOperation(args[0], args[1])
      }),
    )
    .with('docs:discover', () =>
      Effect.gen(function* () {
        yield* requireHostUiArgCount(args, 0, 1)
        return yield* discoverHostUiDocs(args[0])
      }),
    )
    .with('agent-definitions:manage', () =>
      Effect.gen(function* () {
        yield* requireHostUiArgCount(args, 1)
        const input = decodeAgentDefinitionInput(args[0])
        if (!input) return yield* invalidHostUiInput('Agent definition source approval is invalid.')
        return yield* manageHostUiAgentDefinitions({
          senderId: REMOTE_GUI_SENDER_ID,
          command: input.command,
          ...(input.selectedSourcePaths ? { selectedSourcePaths: input.selectedSourcePaths } : {}),
        })
      }),
    )
    .with('git:worktrees:create', () =>
      Effect.gen(function* () {
        yield* requireHostUiArgCount(args, TWO_ARGUMENTS)
        return yield* createHostUiWorktree(args[0], args[1])
      }),
    )
    .with('git:worktrees:remove', () =>
      Effect.gen(function* () {
        yield* requireHostUiArgCount(args, TWO_ARGUMENTS)
        return yield* removeHostUiWorktree(args[0], args[1])
      }),
    )
    .exhaustive()
}

export function dispatchHostUiRequest(input: {
  readonly caller: LocalSessionCallerIdentity
  readonly request: HostUiV1Request
  readonly signal?: AbortSignal
}) {
  const operation = Effect.gen(function* () {
    const localMachineMcpCaller =
      McpHostUi.isMcpHostUiChannel(input.request.channel) &&
      input.caller.profileAuthority === undefined &&
      input.caller.callerId.startsWith('local-user:')
    if (input.caller.callerId !== 'gui:local-user' && !localMachineMcpCaller) {
      return yield* invalidHostUiInput(
        'Host UI operations are only available to the local OpenWaggle GUI or an authenticated local-machine MCP client.',
      )
    }
    const args = input.request.args.map((argument) =>
      argument.kind === 'undefined' ? undefined : argument.value,
    )
    const result = yield* dispatchHostUiChannel(input.request.channel, args)
    return {
      contract: 'host-ui-v1',
      response: {
        contractVersion: input.request.contractVersion,
        requestId: input.request.requestId,
        channel: input.request.channel,
        result:
          result === undefined
            ? { kind: 'undefined' as const }
            : { kind: 'value' as const, value: toHostUiJsonValue(result) },
      },
    } satisfies Extract<LocalSessionCommandResult, { readonly contract: 'host-ui-v1' }>
  })
  return raceHostUiRequestWithSignal(operation, input.signal)
}
