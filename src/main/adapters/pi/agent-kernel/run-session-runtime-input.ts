import type { ExtensionFactory, InlineExtension } from '@earendil-works/pi-coding-agent'
import type { HydratedAgentSendPayload } from '@shared/types/agent'
import type { AgentKernelRunInput } from '../../../ports/agent-kernel-service'
import { scratchDirectorySystemPrompt } from '../pi-provider-resources'
import type {
  PiProjectRuntimeIsolationOptions,
  PiRuntimeExtensionIsolationInput,
} from './runtime-extension-isolation'
import { sessionFallbackModelReference } from './session-model-fallback'

export interface CreatePiRunSessionRuntimeInput extends PiRuntimeExtensionIsolationInput {
  readonly preparedEnvironment?: AgentKernelRunInput['preparedEnvironment']
  readonly session: AgentKernelRunInput['session']
  readonly projectPath: string
  readonly runId: AgentKernelRunInput['runId']
  readonly payload: HydratedAgentSendPayload
  readonly modelReference: AgentKernelRunInput['model']
  /** Continue on the last answering model if the selection is gone (never for a Waggle agent). */
  readonly modelFallback?: 'last-answering-model'
  readonly runAuthorizationOverride?: AgentKernelRunInput['runAuthorizationOverride']
  readonly authorityCallerId?: AgentKernelRunInput['authorityCallerId']
  readonly compactionThresholdPercent: AgentKernelRunInput['compactionThresholdPercent']
  readonly signal: AgentKernelRunInput['signal']
  readonly onEvent: AgentKernelRunInput['onEvent']
  readonly onControlAvailable?: AgentKernelRunInput['onControlAvailable']
  readonly skillToggles?: Readonly<Record<string, boolean>>
  readonly skillAllowlist?: readonly string[]
  readonly extensionFactories?: readonly InlineExtension[]
  readonly trustedExtensionFactories?: readonly ExtensionFactory[]
  readonly systemPromptAppendices?: readonly string[]
  readonly visualizationDirectory?: string
  readonly scratchDirectory?: string
  readonly steeringInputHook?: boolean
}

/** Scratch guidance, then the caller's; the first-turn prefix budget measures this too. */
export function runSystemPromptAppendices(
  input: Pick<CreatePiRunSessionRuntimeInput, 'scratchDirectory' | 'systemPromptAppendices'>,
  describeScratchDirectory: (scratchDirectory: string) => string = scratchDirectorySystemPrompt,
) {
  const appendices = [
    ...(input.scratchDirectory ? [describeScratchDirectory(input.scratchDirectory)] : []),
    ...(input.systemPromptAppendices ?? []),
  ]
  return appendices.length > 0 ? { systemPromptAppendices: appendices } : {}
}

export function runtimeIsolationOptions(
  input: CreatePiRunSessionRuntimeInput,
): PiProjectRuntimeIsolationOptions {
  return {
    projectPath: input.projectPath,
    modelReference: input.modelReference,
    ...(input.modelFallback ? sessionFallbackModelReference(input.session) : {}),
    ...(input.compactionThresholdPercent !== undefined
      ? { compactionThresholdPercent: input.compactionThresholdPercent }
      : {}),
    ...(input.skillToggles ? { skillToggles: input.skillToggles } : {}),
    ...(input.skillAllowlist ? { skillAllowlist: input.skillAllowlist } : {}),
    ...(input.extensionFactories ? { extensionFactories: [...input.extensionFactories] } : {}),
    ...(input.trustedExtensionFactories
      ? { trustedExtensionFactories: [...input.trustedExtensionFactories] }
      : {}),
    ...runSystemPromptAppendices(input),
    ...(input.visualizationDirectory
      ? { visualizationDirectory: input.visualizationDirectory }
      : {}),
  }
}
