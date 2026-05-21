import { WagglePresetId } from '@shared/types/brand'
import type { WagglePreset } from '@shared/types/waggle'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useReducer } from 'react'
import { usePreferencesStore } from '@/features/settings/state/preferences-store'
import {
  useDeleteWagglePresetMutation,
  useSaveWagglePresetMutation,
  wagglePresetsQueryOptions,
} from '@/queries/waggle-presets'
import {
  buildWaggleConfig,
  configMatchesPreset,
  INITIAL_WAGGLE_FORM_STATE,
  INITIAL_WAGGLE_PRESET_STATE,
  type WaggleFormAction,
  type WaggleFormState,
  waggleFormReducer,
  wagglePresetReducer,
} from './waggle-form-state'

export type { WaggleFormAction } from './waggle-form-state'

const SLICE_ARG_2 = 60

function describeWaggleError(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback
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

  function loadPreset(preset: WagglePreset) {
    dispatchPreset({ type: 'select-preset', activePresetId: preset.id })
    dispatchForm({ type: 'load-preset', config: preset.config })
  }

  const currentConfig = buildWaggleConfig(formState)
  const activePreset = presets.find((p) => p.id === activePresetId)
  const isModified = activePreset ? !configMatchesPreset(currentConfig, activePreset) : false
  const queryError = wagglePresetsQuery.error
    ? describeWaggleError(wagglePresetsQuery.error, 'Failed to load Waggle presets.')
    : null
  const displayedError = error ?? queryError

  async function handleSaveEdits() {
    if (!activePreset) return
    const config = buildWaggleConfig(formState)
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

  async function handleNewCustom() {
    const config = buildWaggleConfig(formState)
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

  async function handleDeletePreset(id: string) {
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
