import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from '@mariozechner/pi-coding-agent'
import {
  isWaggleInheritedModel,
  WAGGLE_INHERIT_MODEL,
  type WaggleConfig,
  type WagglePreset,
} from '@openwaggle/waggle-core'
import type { DefaultWaggleCommandInput } from './default-command-types'
import { modelReferenceForCurrentModel } from './default-config-editors'
import {
  appendPiWaggleModeState,
  disabledPiWaggleModeState,
  enabledPiWaggleModeState,
  latestPiWaggleModeStateFromBranch,
} from './mode-state'
import { loadPiWagglePresetLayers, resolvedPresetsForUi } from './presets'

const FIRST_PROVIDER_CHARACTER_INDEX = 0
const MODEL_ID_START_OFFSET = 1

export interface ActiveWaggleState {
  readonly config: WaggleConfig
  readonly presetId?: string
}

function createModelRefFromProviderQualifiedId(modelReference: string) {
  const separatorIndex = modelReference.indexOf('/')
  if (
    separatorIndex <= FIRST_PROVIDER_CHARACTER_INDEX ||
    separatorIndex === modelReference.length - MODEL_ID_START_OFFSET
  ) {
    return null
  }
  return {
    provider: modelReference.slice(FIRST_PROVIDER_CHARACTER_INDEX, separatorIndex),
    id: modelReference.slice(separatorIndex + MODEL_ID_START_OFFSET),
  }
}

export function notify(
  ctx: ExtensionContext,
  message: string,
  type: 'info' | 'warning' | 'error' = 'info',
) {
  if (ctx.hasUI) ctx.ui.notify(message, type)
}

export function setWaggleStatus(ctx: ExtensionContext, text: string | undefined) {
  if (ctx.hasUI) ctx.ui.setStatus('pi-waggle', text)
}

function appendModeState(
  pi: Pick<ExtensionAPI, 'appendEntry'>,
  state: Parameters<typeof appendPiWaggleModeState>[1],
) {
  appendPiWaggleModeState(
    {
      appendCustomEntry: (customType, data) => {
        pi.appendEntry(customType, data)
        return undefined
      },
    },
    state,
  )
}

export function latestActiveState(ctx: ExtensionCommandContext): ActiveWaggleState | null {
  const state = latestPiWaggleModeStateFromBranch(ctx.sessionManager)
  if (!state?.enabled || !state.config) return null
  return {
    config: state.config,
    ...(state.presetId ? { presetId: state.presetId } : {}),
  }
}

function effectiveAgentModelReference(ctx: ExtensionContext, model: string) {
  if (!isWaggleInheritedModel(model)) return model
  return modelReferenceForCurrentModel(ctx)
}

function configRequiresInheritedModel(config: WaggleConfig) {
  return config.agents.some((agent) => isWaggleInheritedModel(agent.model))
}

function findUnavailableModel(ctx: ExtensionContext, config: WaggleConfig) {
  for (const agent of config.agents) {
    const effectiveModel = effectiveAgentModelReference(ctx, agent.model)
    if (!effectiveModel) return WAGGLE_INHERIT_MODEL

    const modelReference = createModelRefFromProviderQualifiedId(effectiveModel)
    if (!modelReference || !ctx.modelRegistry.find(modelReference.provider, modelReference.id)) {
      return effectiveModel
    }
  }

  return null
}

export async function activateConfig(
  input: DefaultWaggleCommandInput & {
    readonly config: WaggleConfig
    readonly prompt?: string
    readonly presetId?: string
    readonly presetName?: string
  },
) {
  if (configRequiresInheritedModel(input.config) && !modelReferenceForCurrentModel(input.ctx)) {
    notify(input.ctx, 'Select a Pi model before enabling inherited Waggle models.', 'error')
    return
  }

  const unavailableModel = findUnavailableModel(input.ctx, input.config)
  if (unavailableModel) {
    const label =
      unavailableModel === WAGGLE_INHERIT_MODEL ? 'standard-mode model' : unavailableModel
    notify(input.ctx, `Pi model ${label} is not available for Waggle mode.`, 'error')
    return
  }

  appendModeState(
    input.pi,
    enabledPiWaggleModeState({
      config: input.config,
      ...(input.presetId ? { presetId: input.presetId } : {}),
    }),
  )
  const statusName = input.presetName ?? 'custom configuration'
  setWaggleStatus(input.ctx, `Waggle enabled: ${statusName}`)
  notify(input.ctx, `Waggle enabled: ${statusName}`)
  if (!input.prompt) return

  await input.ctx.waitForIdle()
  await input.startRun({ ...input, config: input.config, prompt: input.prompt })
}

export async function activatePreset(
  input: DefaultWaggleCommandInput & {
    readonly preset: WagglePreset
    readonly prompt?: string
  },
) {
  await activateConfig({
    ...input,
    config: input.preset.config,
    presetId: input.preset.id,
    presetName: input.preset.name,
  })
}

export async function resolvePresetById(cwd: string, presetId: string) {
  const presets = resolvedPresetsForUi(await loadPiWagglePresetLayers(cwd))
  return presets.find((candidate) => candidate.preset.id === presetId) ?? null
}

export function disableWaggle(input: {
  readonly pi: Pick<ExtensionAPI, 'appendEntry'>
  readonly ctx: ExtensionCommandContext
  readonly setActiveRun: (run: null) => void
}) {
  appendModeState(input.pi, disabledPiWaggleModeState())
  input.setActiveRun(null)
  setWaggleStatus(input.ctx, undefined)
  if (input.ctx.hasUI) input.ctx.ui.setWorkingMessage()
  notify(input.ctx, 'Waggle disabled.')
}
