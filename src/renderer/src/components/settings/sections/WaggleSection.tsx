import { SupportedModelId, TeamConfigId } from '@shared/types/brand'
import { generateDisplayName, type ProviderInfo } from '@shared/types/llm'
import type { Settings } from '@shared/types/settings'
import type {
  WaggleAgentColor,
  WaggleAgentSlot,
  WaggleCollaborationMode,
  WaggleConfig,
  WaggleStopCondition,
  WaggleTeamPreset,
} from '@shared/types/waggle'
import { chooseBy } from '@shared/utils/decision'
import { Plus, Save, Trash2 } from 'lucide-react'
import { useEffect, useReducer, useState } from 'react'
import { usePreferences, useProviders } from '@/hooks/useSettings'
import { AGENT_BG, AGENT_BORDER } from '@/lib/agent-colors'
import { cn } from '@/lib/cn'
import { api } from '@/lib/ipc'
import { ModelSelector } from '../../shared/ModelSelector'

/** Shallow structural comparison between form config and a preset's config. */
function configMatchesPreset(config: WaggleConfig, preset: WaggleTeamPreset): boolean {
  const pc = preset.config
  if (config.mode !== pc.mode) return false
  if (config.stop.primary !== pc.stop.primary) return false
  if (config.stop.maxTurnsSafety !== pc.stop.maxTurnsSafety) return false
  for (let i = 0; i < 2; i++) {
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

type WaggleFormAction =
  | { readonly type: 'load-preset'; readonly config: WaggleConfig }
  | { readonly type: 'set-agent-label'; readonly index: 0 | 1; readonly label: string }
  | { readonly type: 'set-agent-model'; readonly index: 0 | 1; readonly model: SupportedModelId }
  | { readonly type: 'set-agent-role'; readonly index: 0 | 1; readonly roleDescription: string }
  | { readonly type: 'set-agent-color'; readonly index: 0 | 1; readonly color: WaggleAgentColor }
  | { readonly type: 'set-mode'; readonly mode: WaggleCollaborationMode }
  | { readonly type: 'set-stop-condition'; readonly stopCondition: WaggleStopCondition }
  | { readonly type: 'set-max-turns'; readonly maxTurns: number }

const INITIAL_WAGGLE_FORM_STATE: WaggleFormState = {
  agents: [
    {
      label: 'Agent A',
      model: SupportedModelId('claude-sonnet-4-5'),
      roleDescription: '',
      color: 'blue',
    },
    {
      label: 'Agent B',
      model: SupportedModelId('claude-sonnet-4-5'),
      roleDescription: '',
      color: 'amber',
    },
  ],
  mode: 'sequential',
  stopCondition: 'consensus',
  maxTurns: 8,
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
    .case('set-mode', (value) => ({ ...state, mode: value.mode }))
    .case('set-stop-condition', (value) => ({ ...state, stopCondition: value.stopCondition }))
    .case('set-max-turns', (value) => ({ ...state, maxTurns: value.maxTurns }))
    .assertComplete()
}

export function WaggleSection(): React.JSX.Element {
  const { settings } = usePreferences()
  const { providerModels } = useProviders()
  const [presets, setPresets] = useState<WaggleTeamPreset[]>([])
  const [activePresetId, setActivePresetId] = useState<string | null>(null)
  const [formState, dispatchForm] = useReducer(waggleFormReducer, INITIAL_WAGGLE_FORM_STATE)

  useEffect(() => {
    void api.listTeams().then(setPresets)
  }, [])

  function loadPreset(preset: WaggleTeamPreset): void {
    setActivePresetId(preset.id)
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

  // Detect whether the current form config has been modified from the active preset
  const currentConfig = buildConfig()
  const activePreset = presets.find((p) => p.id === activePresetId)
  const isModified = activePreset ? !configMatchesPreset(currentConfig, activePreset) : false

  /** Save edits back to the active preset (works for both built-in overrides and custom). */
  async function handleSaveEdits(): Promise<void> {
    if (!activePreset) return
    const config = buildConfig()
    const [agentA, agentB] = formState.agents
    const saved = await api.saveTeam({
      ...activePreset,
      name: activePreset.isBuiltIn ? activePreset.name : `${agentA.label} + ${agentB.label}`,
      description: activePreset.isBuiltIn
        ? activePreset.description
        : `Custom: ${agentA.roleDescription.slice(0, 60)}`,
      config,
    })
    setPresets(await api.listTeams())
    setActivePresetId(saved.id)
  }

  /** Create a brand new custom preset from the current config. */
  async function handleNewCustom(): Promise<void> {
    const config = buildConfig()
    const [agentA, agentB] = formState.agents
    const name = `${agentA.label} + ${agentB.label}`
    const saved = await api.saveTeam({
      id: TeamConfigId(''),
      name,
      description: `Custom: ${agentA.roleDescription.slice(0, 60)}`,
      config,
      isBuiltIn: false,
      createdAt: 0,
      updatedAt: 0,
    })
    setPresets(await api.listTeams())
    setActivePresetId(saved.id)
  }

  async function handleDeletePreset(id: string): Promise<void> {
    await api.deleteTeam(TeamConfigId(id))
    setPresets(await api.listTeams())
    if (activePresetId === id) setActivePresetId(null)
  }

  const [agentA, agentB] = formState.agents

  return (
    <div className="space-y-6">
      <h2 className="text-[20px] font-semibold text-text-primary">Waggle Mode</h2>

      <TeamPresetsPanel
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
        label={agentA.label}
        onLabelChange={(label) => dispatchForm({ type: 'set-agent-label', index: 0, label })}
        model={agentA.model}
        onModelChange={(model) => dispatchForm({ type: 'set-agent-model', index: 0, model })}
        role={agentA.roleDescription}
        onRoleChange={(roleDescription) =>
          dispatchForm({ type: 'set-agent-role', index: 0, roleDescription })
        }
        color={agentA.color}
        onColorChange={(color) => dispatchForm({ type: 'set-agent-color', index: 0, color })}
        dotLabel="A"
        settings={settings}
        providerModels={providerModels}
      />

      {/* Agent B */}
      <AgentSlotCard
        label={agentB.label}
        onLabelChange={(label) => dispatchForm({ type: 'set-agent-label', index: 1, label })}
        model={agentB.model}
        onModelChange={(model) => dispatchForm({ type: 'set-agent-model', index: 1, model })}
        role={agentB.roleDescription}
        onRoleChange={(roleDescription) =>
          dispatchForm({ type: 'set-agent-role', index: 1, roleDescription })
        }
        color={agentB.color}
        onColorChange={(color) => dispatchForm({ type: 'set-agent-color', index: 1, color })}
        dotLabel="B"
        settings={settings}
        providerModels={providerModels}
      />

      <CollaborationSettingsCard
        mode={formState.mode}
        stopCondition={formState.stopCondition}
        maxTurns={formState.maxTurns}
        onModeChange={(mode) => dispatchForm({ type: 'set-mode', mode })}
        onStopConditionChange={(stopCondition) =>
          dispatchForm({ type: 'set-stop-condition', stopCondition })
        }
        onMaxTurnsChange={(maxTurns) => dispatchForm({ type: 'set-max-turns', maxTurns })}
      />
    </div>
  )
}

interface TeamPresetsPanelProps {
  presets: WaggleTeamPreset[]
  activePresetId: string | null
  isModified: boolean
  onLoadPreset: (preset: WaggleTeamPreset) => void
  onDeletePreset: (id: string) => Promise<void>
  onSaveEdits: () => Promise<void>
  onNewCustom: () => Promise<void>
}

function TeamPresetsPanel({
  presets,
  activePresetId,
  isModified,
  onLoadPreset,
  onDeletePreset,
  onSaveEdits,
  onNewCustom,
}: TeamPresetsPanelProps): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-[#111418] p-5">
      <h3 className="text-sm font-medium text-text-secondary mb-4">Team Presets</h3>

      <div className="grid grid-cols-2 gap-3">
        {presets.map((preset) => (
          <TeamPresetCard
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

interface TeamPresetCardProps {
  preset: WaggleTeamPreset
  isActive: boolean
  isActiveModified: boolean
  onSelect: () => void
  onDelete: () => Promise<void>
}

function TeamPresetCard({
  preset,
  isActive,
  isActiveModified,
  onSelect,
  onDelete,
}: TeamPresetCardProps): React.JSX.Element {
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
              {preset.config.mode}
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
  mode: WaggleCollaborationMode
  stopCondition: WaggleStopCondition
  maxTurns: number
  onModeChange: (mode: WaggleCollaborationMode) => void
  onStopConditionChange: (stopCondition: WaggleStopCondition) => void
  onMaxTurnsChange: (maxTurns: number) => void
}

function CollaborationSettingsCard({
  mode,
  stopCondition,
  maxTurns,
  onModeChange,
  onStopConditionChange,
  onMaxTurnsChange,
}: CollaborationSettingsCardProps): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-[#111418] p-5 space-y-4">
      <h3 className="text-sm font-medium text-text-secondary">Collaboration</h3>

      <div className="flex items-center justify-between h-[40px]">
        <span className="text-[13px] text-text-primary">Mode</span>
        <ModeToggle mode={mode} onModeChange={onModeChange} />
      </div>

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

interface ModeToggleProps {
  mode: WaggleCollaborationMode
  onModeChange: (mode: WaggleCollaborationMode) => void
}

function ModeToggle({ mode, onModeChange }: ModeToggleProps): React.JSX.Element {
  return (
    <div className="flex rounded-md border border-border overflow-hidden">
      <button
        type="button"
        onClick={() => onModeChange('sequential')}
        className={cn(
          'px-3 py-1.5 text-[12px] font-medium transition-colors',
          mode === 'sequential'
            ? 'bg-accent/15 text-accent'
            : 'bg-bg text-text-tertiary hover:text-text-secondary',
        )}
      >
        Sequential
      </button>
      <button
        type="button"
        onClick={() => onModeChange('parallel')}
        className={cn(
          'px-3 py-1.5 text-[12px] font-medium transition-colors border-l border-border',
          mode === 'parallel'
            ? 'bg-accent/15 text-accent'
            : 'bg-bg text-text-tertiary hover:text-text-secondary',
        )}
      >
        Parallel
      </button>
    </div>
  )
}

interface StopConditionToggleProps {
  stopCondition: WaggleStopCondition
  onStopConditionChange: (stopCondition: WaggleStopCondition) => void
}

function StopConditionToggle({
  stopCondition,
  onStopConditionChange,
}: StopConditionToggleProps): React.JSX.Element {
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

function MaxTurnsSlider({ maxTurns, onMaxTurnsChange }: MaxTurnsSliderProps): React.JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={4}
        max={20}
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
  label: string
  onLabelChange: (label: string) => void
  model: SupportedModelId
  onModelChange: (model: SupportedModelId) => void
  role: string
  onRoleChange: (role: string) => void
  color: WaggleAgentColor
  onColorChange: (color: WaggleAgentColor) => void
  dotLabel: string
  settings: Settings
  providerModels: ProviderInfo[]
}

function AgentSlotCard({
  label,
  onLabelChange,
  model,
  onModelChange,
  role,
  onRoleChange,
  color,
  onColorChange,
  dotLabel,
  settings,
  providerModels,
}: AgentSlotCardProps): React.JSX.Element {
  return (
    <div className={cn('rounded-lg border bg-[#111418] p-5 space-y-4', AGENT_BORDER[color])}>
      <div className="flex items-center gap-2">
        <div className={cn('h-2.5 w-2.5 rounded-full', AGENT_BG[color])} />
        <h3 className="text-sm font-medium text-text-secondary">Agent {dotLabel}</h3>
      </div>

      {/* Label */}
      <div className="flex items-center justify-between h-[40px]">
        <span className="text-[13px] text-text-primary">Label</span>
        <input
          type="text"
          value={label}
          onChange={(e) => onLabelChange(e.target.value)}
          className="w-[200px] rounded-md border border-border bg-bg px-2.5 py-1.5 text-[13px] text-text-primary focus:border-border-light focus:outline-none"
        />
      </div>

      {/* Model */}
      <div className="flex items-center justify-between h-[40px]">
        <span className="text-[13px] text-text-primary">Model</span>
        <ModelSelector
          value={model}
          onChange={onModelChange}
          settings={settings}
          providerModels={providerModels}
        />
      </div>

      {/* Role */}
      <div className="space-y-1.5">
        <span className="text-[13px] text-text-primary">Role description</span>
        <textarea
          value={role}
          onChange={(e) => onRoleChange(e.target.value)}
          rows={3}
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
              onClick={() => onColorChange(c)}
              className={cn(
                'h-6 w-6 rounded-full transition-all',
                AGENT_BG[c],
                color === c
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
