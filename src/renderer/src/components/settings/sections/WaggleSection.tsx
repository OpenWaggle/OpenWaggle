import { generateDisplayName, type ProviderInfo } from '@shared/types/llm'
import type { Settings } from '@shared/types/settings'
import type { WaggleAgentSlot, WagglePreset, WaggleStopCondition } from '@shared/types/waggle'
import { Plus, Save, Trash2 } from 'lucide-react'
import { usePreferences, useProviders } from '@/hooks/useSettings'
import { AGENT_BG, AGENT_BORDER } from '@/lib/agent-colors'
import { cn } from '@/lib/cn'
import { ModelSelector } from '../../shared/ModelSelector'
import { useWaggleForm, type WaggleFormAction } from './useWaggleForm'

const MIN = 4
const MAX = 20
const ROWS = 3

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

      {/* Agent A */}
      <AgentSlotCard
        index={0}
        agent={agentA}
        dispatchForm={dispatchForm}
        dotLabel="A"
        settings={settings}
        providerModels={providerModels}
      />

      {/* Agent B */}
      <AgentSlotCard
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

interface WagglePresetsPanelProps {
  presets: readonly WagglePreset[]
  activePresetId: string | null
  isModified: boolean
  onLoadPreset: (preset: WagglePreset) => void
  onDeletePreset: (id: string) => Promise<void>
  onSaveEdits: () => Promise<void>
  onNewCustom: () => Promise<void>
}

function WagglePresetsPanel({
  presets,
  activePresetId,
  isModified,
  onLoadPreset,
  onDeletePreset,
  onSaveEdits,
  onNewCustom,
}: WagglePresetsPanelProps) {
  return (
    <div className="rounded-lg border border-border bg-[#111418] p-5">
      <h3 className="text-sm font-medium text-text-secondary mb-4">Waggle Presets</h3>

      <div className="grid grid-cols-2 gap-3">
        {presets.map((preset) => (
          <WagglePresetCard
            key={preset.id}
            preset={preset}
            isActive={activePresetId === preset.id}
            isActiveModified={activePresetId === preset.id && isModified}
            onSelect={() => onLoadPreset(preset)}
            onDelete={() => onDeletePreset(preset.id)}
          />
        ))}
      </div>

      <div className="mt-3 flex gap-2">
        {isModified && (
          <button
            type="button"
            onClick={() => void onSaveEdits()}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-accent/30 bg-accent/5 p-2.5 text-[12px] font-medium text-accent hover:bg-accent/10 transition-colors"
          >
            <Save className="h-3 w-3" />
            Save Changes
          </button>
        )}

        <button
          type="button"
          onClick={() => void onNewCustom()}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-dashed border-border p-2.5 text-[12px] font-medium text-text-muted hover:border-border-light hover:text-text-secondary transition-colors"
        >
          <Plus className="h-3 w-3" />
          New Custom Preset
        </button>
      </div>
    </div>
  )
}

interface WagglePresetCardProps {
  preset: WagglePreset
  isActive: boolean
  isActiveModified: boolean
  onSelect: () => void
  onDelete: () => Promise<void>
}

function WagglePresetCard({
  preset,
  isActive,
  isActiveModified,
  onSelect,
  onDelete,
}: WagglePresetCardProps) {
  return (
    <button
      type="button"
      className={cn(
        'rounded-lg border p-3 cursor-pointer transition-colors text-left',
        isActive && !isActiveModified && 'border-accent/40 bg-accent/5',
        isActiveModified && 'border-accent/20 bg-accent/5',
        !isActive && 'border-border bg-bg hover:border-border-light',
      )}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[13px] font-medium text-text-primary truncate">
              {preset.name}
            </span>
            <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-bg-tertiary text-text-muted">
              Sequential
            </span>
            {!preset.isBuiltIn && (
              <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-accent/10 text-accent">
                Custom
              </span>
            )}
            {isActiveModified && (
              <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-blue-500/10 text-blue-400">
                Edited
              </span>
            )}
          </div>
          <p className="text-[12px] text-text-tertiary line-clamp-2">{preset.description}</p>
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-text-muted">
            <div
              className={cn('h-1.5 w-1.5 rounded-full', AGENT_BG[preset.config.agents[0].color])}
            />
            <span className="truncate">{generateDisplayName(preset.config.agents[0].model)}</span>
            <span className="text-text-tertiary">vs</span>
            <div
              className={cn('h-1.5 w-1.5 rounded-full', AGENT_BG[preset.config.agents[1].color])}
            />
            <span className="truncate">{generateDisplayName(preset.config.agents[1].model)}</span>
          </div>
        </div>
        {!preset.isBuiltIn && (
          <span
            role="none"
            onClick={(e) => {
              e.stopPropagation()
              void onDelete()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation()
                void onDelete()
              }
            }}
            className="p-1 rounded text-text-muted hover:text-error transition-colors cursor-pointer"
          >
            <Trash2 className="h-3 w-3" />
          </span>
        )}
      </div>
    </button>
  )
}

interface CollaborationSettingsCardProps {
  stopCondition: WaggleStopCondition
  maxTurns: number
  onStopConditionChange: (stopCondition: WaggleStopCondition) => void
  onMaxTurnsChange: (maxTurns: number) => void
}

function CollaborationSettingsCard({
  stopCondition,
  maxTurns,
  onStopConditionChange,
  onMaxTurnsChange,
}: CollaborationSettingsCardProps) {
  return (
    <div className="rounded-lg border border-border bg-[#111418] p-5 space-y-4">
      <h3 className="text-sm font-medium text-text-secondary">Collaboration</h3>

      <div className="flex items-center justify-between h-[40px]">
        <span className="text-[13px] text-text-primary">Stop when</span>
        <StopConditionToggle
          stopCondition={stopCondition}
          onStopConditionChange={onStopConditionChange}
        />
      </div>

      <div className="flex items-center justify-between h-[40px]">
        <span className="text-[13px] text-text-primary">Max turns</span>
        <MaxTurnsSlider maxTurns={maxTurns} onMaxTurnsChange={onMaxTurnsChange} />
      </div>
    </div>
  )
}

interface StopConditionToggleProps {
  stopCondition: WaggleStopCondition
  onStopConditionChange: (stopCondition: WaggleStopCondition) => void
}

function StopConditionToggle({ stopCondition, onStopConditionChange }: StopConditionToggleProps) {
  return (
    <div className="flex rounded-md border border-border overflow-hidden">
      <button
        type="button"
        onClick={() => onStopConditionChange('consensus')}
        className={cn(
          'px-3 py-1.5 text-[12px] font-medium transition-colors',
          stopCondition === 'consensus'
            ? 'bg-accent/15 text-accent'
            : 'bg-bg text-text-tertiary hover:text-text-secondary',
        )}
      >
        Consensus
      </button>
      <button
        type="button"
        onClick={() => onStopConditionChange('user-stop')}
        className={cn(
          'px-3 py-1.5 text-[12px] font-medium transition-colors border-l border-border',
          stopCondition === 'user-stop'
            ? 'bg-accent/15 text-accent'
            : 'bg-bg text-text-tertiary hover:text-text-secondary',
        )}
      >
        Manual
      </button>
    </div>
  )
}

interface MaxTurnsSliderProps {
  maxTurns: number
  onMaxTurnsChange: (maxTurns: number) => void
}

function MaxTurnsSlider({ maxTurns, onMaxTurnsChange }: MaxTurnsSliderProps) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={MIN}
        max={MAX}
        value={maxTurns}
        onChange={(e) => onMaxTurnsChange(Number(e.target.value))}
        className="w-[120px] accent-accent"
      />
      <span className="text-[13px] text-text-secondary w-6 text-right">{maxTurns}</span>
    </div>
  )
}

// ─── Agent Slot Card ──────────────────────────────────────────

interface AgentSlotCardProps {
  index: 0 | 1
  agent: WaggleAgentSlot
  dispatchForm: (action: WaggleFormAction) => void
  dotLabel: string
  settings: Settings
  providerModels: ProviderInfo[]
}

function AgentSlotCard({
  index,
  agent,
  dispatchForm,
  dotLabel,
  settings,
  providerModels,
}: AgentSlotCardProps) {
  return (
    <div className={cn('rounded-lg border bg-[#111418] p-5 space-y-4', AGENT_BORDER[agent.color])}>
      <div className="flex items-center gap-2">
        <div className={cn('h-2.5 w-2.5 rounded-full', AGENT_BG[agent.color])} />
        <h3 className="text-sm font-medium text-text-secondary">Agent {dotLabel}</h3>
      </div>

      {/* Label */}
      <div className="flex items-center justify-between h-[40px]">
        <span className="text-[13px] text-text-primary">Label</span>
        <input
          type="text"
          value={agent.label}
          onChange={(e) => dispatchForm({ type: 'set-agent-label', index, label: e.target.value })}
          className="w-[200px] rounded-md border border-border bg-bg px-2.5 py-1.5 text-[13px] text-text-primary focus:border-border-light focus:outline-none"
        />
      </div>

      {/* Model */}
      <div className="flex items-center justify-between h-[40px]">
        <span className="text-[13px] text-text-primary">Model</span>
        <ModelSelector
          value={agent.model}
          onChange={(model) => dispatchForm({ type: 'set-agent-model', index, model })}
          settings={settings}
          providerModels={providerModels}
        />
      </div>

      {/* Role */}
      <div className="space-y-1.5">
        <span className="text-[13px] text-text-primary">Role description</span>
        <textarea
          value={agent.roleDescription}
          onChange={(e) =>
            dispatchForm({ type: 'set-agent-role', index, roleDescription: e.target.value })
          }
          rows={ROWS}
          placeholder="Describe this agent's role and perspective..."
          className={cn(
            'w-full rounded-md border border-border bg-bg px-3 py-2 text-[13px] text-text-primary resize-none',
            'placeholder:text-text-tertiary focus:border-border-light focus:outline-none',
          )}
        />
      </div>

      {/* Color */}
      <div className="flex items-center justify-between h-[40px]">
        <span className="text-[13px] text-text-primary">Color</span>
        <div className="flex items-center gap-2">
          {(['blue', 'amber', 'emerald', 'violet'] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => dispatchForm({ type: 'set-agent-color', index, color: c })}
              className={cn(
                'h-6 w-6 rounded-full transition-all',
                AGENT_BG[c],
                agent.color === c
                  ? 'ring-2 ring-white/40 ring-offset-1 ring-offset-[#111418]'
                  : 'opacity-50 hover:opacity-75',
              )}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
