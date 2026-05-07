import { DOUBLE_FACTOR } from '@shared/constants/math'
import { type SupportedModelId, WagglePresetId } from '@shared/types/brand'
import { DEFAULT_MODEL_REF } from '@shared/types/settings'
import type {
  WaggleAgentColor,
  WaggleAgentSlot,
  WaggleCollaborationMode,
  WaggleConfig,
  WagglePreset,
  WaggleStopCondition,
} from '@shared/types/waggle'
import { chooseBy } from '@shared/utils/decision'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useReducer } from 'react'
import {
  useDeleteWagglePresetMutation,
  useSaveWagglePresetMutation,
  wagglePresetsQueryOptions,
} from '@/queries/waggle-presets'
import { usePreferencesStore } from '@/stores/preferences-store'

const MAX_TURNS = 8
const SLICE_ARG_2 = 60

function describeWaggleError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

/** Shallow structural comparison between form config and a preset's config. */
function configMatchesPreset(config: WaggleConfig, preset: WagglePreset): boolean {
  const pc = preset.config
  if (config.mode !== pc.mode) return false
  if (config.stop.primary !== pc.stop.primary) return false
  if (config.stop.maxTurnsSafety !== pc.stop.maxTurnsSafety) return false
  for (let i = 0; i < DOUBLE_FACTOR; i++) {
    const a = config.agents[i]
    const p = pc.agents[i]
    if (!a || !p) return false
    if (a.label !== p.label) return false
    if (a.model !== p.model) return false
    if (a.roleDescription !== p.roleDescription) return false
    if (a.color !== p.color) return false
  }
  return true
}

interface WaggleFormState {
  readonly agents: readonly [WaggleAgentSlot, WaggleAgentSlot]
  readonly mode: WaggleCollaborationMode
  readonly stopCondition: WaggleStopCondition
  readonly maxTurns: number
}

interface WagglePresetState {
  readonly activePresetId: string | null
  readonly error: string | null
}

export type WaggleFormAction =
  | { readonly type: 'load-preset'; readonly config: WaggleConfig }
  | { readonly type: 'set-agent-label'; readonly index: 0 | 1; readonly label: string }
  | { readonly type: 'set-agent-model'; readonly index: 0 | 1; readonly model: SupportedModelId }
  | { readonly type: 'set-agent-role'; readonly index: 0 | 1; readonly roleDescription: string }
  | { readonly type: 'set-agent-color'; readonly index: 0 | 1; readonly color: WaggleAgentColor }
  | { readonly type: 'set-stop-condition'; readonly stopCondition: WaggleStopCondition }
  | { readonly type: 'set-max-turns'; readonly maxTurns: number }

type WagglePresetAction =
  | { readonly type: 'select-preset'; readonly activePresetId: string }
  | { readonly type: 'save-success'; readonly activePresetId: string }
  | { readonly type: 'clear-active-preset' }
  | { readonly type: 'clear-error' }
  | { readonly type: 'set-error'; readonly error: string }

const INITIAL_WAGGLE_FORM_STATE: WaggleFormState = {
  agents: [
    {
      label: 'Agent A',
      model: DEFAULT_MODEL_REF,
      roleDescription: '',
      color: 'blue',
    },
    {
      label: 'Agent B',
      model: DEFAULT_MODEL_REF,
      roleDescription: '',
      color: 'amber',
    },
  ],
  mode: 'sequential',
  stopCondition: 'consensus',
  maxTurns: MAX_TURNS,
}

const INITIAL_WAGGLE_PRESET_STATE: WagglePresetState = {
  activePresetId: null,
  error: null,
}

function updateAgentAt(
  agents: readonly [WaggleAgentSlot, WaggleAgentSlot],
  index: 0 | 1,
  update: (agent: WaggleAgentSlot) => WaggleAgentSlot,
): readonly [WaggleAgentSlot, WaggleAgentSlot] {
  if (index === 0) {
    return [update(agents[0]), agents[1]]
  }
  return [agents[0], update(agents[1])]
}

function waggleFormReducer(state: WaggleFormState, action: WaggleFormAction): WaggleFormState {
  return chooseBy(action, 'type')
    .case('load-preset', (value) => ({
      agents: value.config.agents,
      mode: value.config.mode,
      stopCondition: value.config.stop.primary,
      maxTurns: value.config.stop.maxTurnsSafety,
    }))
    .case('set-agent-label', (value) => ({
      ...state,
      agents: updateAgentAt(state.agents, value.index, (agent) => ({
        ...agent,
        label: value.label,
      })),
    }))
    .case('set-agent-model', (value) => ({
      ...state,
      agents: updateAgentAt(state.agents, value.index, (agent) => ({
        ...agent,
        model: value.model,
      })),
    }))
    .case('set-agent-role', (value) => ({
      ...state,
      agents: updateAgentAt(state.agents, value.index, (agent) => ({
        ...agent,
        roleDescription: value.roleDescription,
      })),
    }))
    .case('set-agent-color', (value) => ({
      ...state,
      agents: updateAgentAt(state.agents, value.index, (agent) => ({
        ...agent,
        color: value.color,
      })),
    }))
    .case('set-stop-condition', (value) => ({ ...state, stopCondition: value.stopCondition }))
    .case('set-max-turns', (value) => ({ ...state, maxTurns: value.maxTurns }))
    .assertComplete()
}

function wagglePresetReducer(
  state: WagglePresetState,
  action: WagglePresetAction,
): WagglePresetState {
  return chooseBy(action, 'type')
    .case('select-preset', (value) => ({
      ...state,
      activePresetId: value.activePresetId,
    }))
    .case('save-success', (value) => ({
      ...state,
      activePresetId: value.activePresetId,
      error: null,
    }))
    .case('clear-active-preset', () => ({
      ...state,
      activePresetId: null,
    }))
    .case('clear-error', () => ({
      ...state,
      error: null,
    }))
    .case('set-error', (value) => ({
      ...state,
      error: value.error,
    }))
    .assertComplete()
}

export interface WaggleFormHook {
  readonly formState: WaggleFormState
  readonly dispatchForm: React.Dispatch<WaggleFormAction>
  readonly presets: readonly WagglePreset[]
  readonly activePresetId: string | null
  readonly isModified: boolean
  readonly displayedError: string | null
  readonly loadPreset: (preset: WagglePreset) => void
  readonly handleSaveEdits: () => Promise<void>
  readonly handleNewCustom: () => Promise<void>
  readonly handleDeletePreset: (id: string) => Promise<void>
}

export function useWaggleForm(): WaggleFormHook {
  const projectPath = usePreferencesStore((state) => state.settings.projectPath)
  const wagglePresetsQuery = useQuery(wagglePresetsQueryOptions(projectPath))
  const saveWagglePresetMutation = useSaveWagglePresetMutation(projectPath)
  const deleteWagglePresetMutation = useDeleteWagglePresetMutation(projectPath)
  const [formState, dispatchForm] = useReducer(waggleFormReducer, INITIAL_WAGGLE_FORM_STATE)
  const [presetState, dispatchPreset] = useReducer(wagglePresetReducer, INITIAL_WAGGLE_PRESET_STATE)
  const { activePresetId, error } = presetState
  const presets = wagglePresetsQuery.data ?? []

  useEffect(() => {
    if (!activePresetId) return
    if (presets.some((preset) => preset.id === activePresetId)) return
    dispatchPreset({ type: 'clear-active-preset' })
  }, [activePresetId, presets])

  function loadPreset(preset: WagglePreset): void {
    dispatchPreset({ type: 'select-preset', activePresetId: preset.id })
    dispatchForm({ type: 'load-preset', config: preset.config })
  }

  function buildConfig(): WaggleConfig {
    const [agentA, agentB] = formState.agents
    return {
      mode: formState.mode,
      agents: [agentA, agentB],
      stop: { primary: formState.stopCondition, maxTurnsSafety: formState.maxTurns },
    }
  }

  const currentConfig = buildConfig()
  const activePreset = presets.find((p) => p.id === activePresetId)
  const isModified = activePreset ? !configMatchesPreset(currentConfig, activePreset) : false
  const queryError = wagglePresetsQuery.error
    ? describeWaggleError(wagglePresetsQuery.error, 'Failed to load Waggle presets.')
    : null
  const displayedError = error ?? queryError

  async function handleSaveEdits(): Promise<void> {
    if (!activePreset) return
    const config = buildConfig()
    const [agentA, agentB] = formState.agents
    const saveInput = {
      ...activePreset,
      name: activePreset.isBuiltIn ? activePreset.name : `${agentA.label} + ${agentB.label}`,
      description: activePreset.isBuiltIn
        ? activePreset.description
        : `Custom: ${agentA.roleDescription.slice(0, SLICE_ARG_2)}`,
      config,
    }
    dispatchPreset({ type: 'clear-error' })

    try {
      const saved = await saveWagglePresetMutation.mutateAsync(saveInput)
      dispatchPreset({ type: 'save-success', activePresetId: saved.id })
    } catch (saveError) {
      dispatchPreset({
        type: 'set-error',
        error: describeWaggleError(saveError, 'Failed to save Waggle preset.'),
      })
    }
  }

  async function handleNewCustom(): Promise<void> {
    const config = buildConfig()
    const [agentA, agentB] = formState.agents
    const saveInput = {
      id: WagglePresetId(''),
      name: `${agentA.label} + ${agentB.label}`,
      description: `Custom: ${agentA.roleDescription.slice(0, SLICE_ARG_2)}`,
      config,
      isBuiltIn: false,
      createdAt: 0,
      updatedAt: 0,
    }
    dispatchPreset({ type: 'clear-error' })

    try {
      const saved = await saveWagglePresetMutation.mutateAsync(saveInput)
      dispatchPreset({ type: 'save-success', activePresetId: saved.id })
    } catch (saveError) {
      dispatchPreset({
        type: 'set-error',
        error: describeWaggleError(saveError, 'Failed to create Waggle preset.'),
      })
    }
  }

  async function handleDeletePreset(id: string): Promise<void> {
    dispatchPreset({ type: 'clear-error' })

    try {
      await deleteWagglePresetMutation.mutateAsync(WagglePresetId(id))
      if (activePresetId === id) {
        dispatchPreset({ type: 'clear-active-preset' })
      }
    } catch (deleteError) {
      dispatchPreset({
        type: 'set-error',
        error: describeWaggleError(deleteError, 'Failed to delete Waggle preset.'),
      })
    }
  }

  return {
    formState,
    dispatchForm,
    presets,
    activePresetId,
    isModified,
    displayedError,
    loadPreset,
    handleSaveEdits,
    handleNewCustom,
    handleDeletePreset,
  }
}
