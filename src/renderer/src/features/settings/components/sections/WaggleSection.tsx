import { usePreferences, useProviders } from '@/features/settings/hooks/useSettings'
import { useWaggleForm } from '../../hooks/useWaggleForm'
import { WaggleAgentSlotCard } from './WaggleAgentSlotCard'
import { CollaborationSettingsCard } from './WaggleCollaborationSettingsCard'
import { WagglePresetsPanel } from './WagglePresetsPanel'

export function WaggleSection() {
  const { settings } = usePreferences()
  const { providerModels } = useProviders()
  const {
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
  } = useWaggleForm()

  const [agentA, agentB] = formState.agents

  return (
    <div className="space-y-6">
      <h2 className="text-[20px] font-semibold text-text-primary">Waggle Mode</h2>
      {displayedError && (
        <p
          role="alert"
          className="rounded-lg border border-error/25 bg-error/6 px-3 py-2 text-sm text-error"
        >
          {displayedError}
        </p>
      )}
      <WagglePresetsPanel
        presets={presets}
        activePresetId={activePresetId}
        isModified={isModified}
        onLoadPreset={loadPreset}
        onDeletePreset={handleDeletePreset}
        onSaveEdits={handleSaveEdits}
        onNewCustom={handleNewCustom}
      />
      <WaggleAgentSlotCard
        index={0}
        agent={agentA}
        dispatchForm={dispatchForm}
        dotLabel="A"
        settings={settings}
        providerModels={providerModels}
      />
      <WaggleAgentSlotCard
        index={1}
        agent={agentB}
        dispatchForm={dispatchForm}
        dotLabel="B"
        settings={settings}
        providerModels={providerModels}
      />
      <CollaborationSettingsCard
        stopCondition={formState.stopCondition}
        maxTurns={formState.maxTurns}
        onStopConditionChange={(stopCondition) =>
          dispatchForm({ type: 'set-stop-condition', stopCondition })
        }
        onMaxTurnsChange={(maxTurns) => dispatchForm({ type: 'set-max-turns', maxTurns })}
      />
    </div>
  )
}
