import { SupportedModelId, TeamConfigId } from '@shared/types/brand'
import { generateDisplayName, type ProviderInfo } from '@shared/types/llm'
import type {
  AgentColor,
  CollaborationMode,
  MultiAgentConfig,
  StopCondition,
  TeamPreset,
} from '@shared/types/multi-agent'
import type { Settings } from '@shared/types/settings'
import { Plus, Save, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSettings } from '@/hooks/useSettings'
import { AGENT_BG, AGENT_BORDER } from '@/lib/agent-colors'
import { cn } from '@/lib/cn'
import { api } from '@/lib/ipc'
import { ModelSelector } from '../../shared/ModelSelector'

/** Shallow structural comparison between form config and a preset's config. */
function configMatchesPreset(config: MultiAgentConfig, preset: TeamPreset): boolean {
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

export function WaggleSection(): React.JSX.Element {
  const { settings, providerModels } = useSettings()
  const [presets, setPresets] = useState<TeamPreset[]>([])
  const [activePresetId, setActivePresetId] = useState<string | null>(null)

  // Agent A config
  const [agentALabel, setAgentALabel] = useState('Agent A')
  const [agentAModel, setAgentAModel] = useState(SupportedModelId('claude-sonnet-4-5'))
  const [agentARole, setAgentARole] = useState('')
  const [agentAColor, setAgentAColor] = useState<AgentColor>('blue')

  // Agent B config
  const [agentBLabel, setAgentBLabel] = useState('Agent B')
  const [agentBModel, setAgentBModel] = useState(SupportedModelId('claude-sonnet-4-5'))
  const [agentBRole, setAgentBRole] = useState('')
  const [agentBColor, setAgentBColor] = useState<AgentColor>('amber')

  // Collaboration config
  const [mode, setMode] = useState<CollaborationMode>('sequential')
  const [stopCondition, setStopCondition] = useState<StopCondition>('consensus')
  const [maxTurns, setMaxTurns] = useState(8)

  useEffect(() => {
    void api.listTeams().then(setPresets)
  }, [])

  function loadPreset(preset: TeamPreset): void {
    setActivePresetId(preset.id)
    const [a, b] = preset.config.agents
    setAgentALabel(a.label)
    setAgentAModel(a.model)
    setAgentARole(a.roleDescription)
    setAgentAColor(a.color)
    setAgentBLabel(b.label)
    setAgentBModel(b.model)
    setAgentBRole(b.roleDescription)
    setAgentBColor(b.color)
    setMode(preset.config.mode)
    setStopCondition(preset.config.stop.primary)
    setMaxTurns(preset.config.stop.maxTurnsSafety)
  }

  function buildConfig(): MultiAgentConfig {
    return {
      mode,
      agents: [
        { label: agentALabel, model: agentAModel, roleDescription: agentARole, color: agentAColor },
        { label: agentBLabel, model: agentBModel, roleDescription: agentBRole, color: agentBColor },
      ],
      stop: { primary: stopCondition, maxTurnsSafety: maxTurns },
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
    const saved = await api.saveTeam({
      ...activePreset,
      name: activePreset.isBuiltIn ? activePreset.name : `${agentALabel} + ${agentBLabel}`,
      description: activePreset.isBuiltIn
        ? activePreset.description
        : `Custom: ${agentARole.slice(0, 60)}`,
      config,
    })
    setPresets(await api.listTeams())
    setActivePresetId(saved.id)
  }

  /** Create a brand new custom preset from the current config. */
  async function handleNewCustom(): Promise<void> {
    const config = buildConfig()
    const name = `${agentALabel} + ${agentBLabel}`
    const saved = await api.saveTeam({
      id: TeamConfigId(''),
      name,
      description: `Custom: ${agentARole.slice(0, 60)}`,
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

  return (
    <div className="space-y-6">
      <h2 className="text-[20px] font-semibold text-text-primary">Waggle Mode</h2>

      {/* Team Presets */}
      <div className="rounded-lg border border-border bg-[#111418] p-5">
        <h3 className="text-sm font-medium text-text-secondary mb-4">Team Presets</h3>

        <div className="grid grid-cols-2 gap-3">
          {presets.map((preset) => {
            const isActive = activePresetId === preset.id
            const isActiveModified = isActive && isModified
            return (
              <button
                type="button"
                key={preset.id}
                className={cn(
                  'rounded-lg border p-3 cursor-pointer transition-colors text-left',
                  isActive && !isActiveModified && 'border-accent/40 bg-accent/5',
                  isActiveModified && 'border-accent/20 bg-accent/5',
                  !isActive && 'border-border bg-bg hover:border-border-light',
                )}
                onClick={() => loadPreset(preset)}
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
                    <p className="text-[12px] text-text-tertiary line-clamp-2">
                      {preset.description}
                    </p>
                    <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-text-muted">
                      <div
                        className={cn(
                          'h-1.5 w-1.5 rounded-full',
                          AGENT_BG[preset.config.agents[0].color],
                        )}
                      />
                      <span className="truncate">
                        {generateDisplayName(preset.config.agents[0].model)}
                      </span>
                      <span className="text-text-tertiary">vs</span>
                      <div
                        className={cn(
                          'h-1.5 w-1.5 rounded-full',
                          AGENT_BG[preset.config.agents[1].color],
                        )}
                      />
                      <span className="truncate">
                        {generateDisplayName(preset.config.agents[1].model)}
                      </span>
                    </div>
                  </div>
                  {!preset.isBuiltIn && (
                    <span
                      role="none"
                      onClick={(e) => {
                        e.stopPropagation()
                        void handleDeletePreset(preset.id)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.stopPropagation()
                          void handleDeletePreset(preset.id)
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
          })}
        </div>

        {/* Action buttons */}
        <div className="mt-3 flex gap-2">
          {/* Save edits — shown when the active preset has been modified */}
          {isModified && (
            <button
              type="button"
              onClick={() => void handleSaveEdits()}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-accent/30 bg-accent/5 p-2.5 text-[12px] font-medium text-accent hover:bg-accent/10 transition-colors"
            >
              <Save className="h-3 w-3" />
              Save Changes
            </button>
          )}

          {/* New custom preset */}
          <button
            type="button"
            onClick={() => void handleNewCustom()}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-dashed border-border p-2.5 text-[12px] font-medium text-text-muted hover:border-border-light hover:text-text-secondary transition-colors"
          >
            <Plus className="h-3 w-3" />
            New Custom Preset
          </button>
        </div>
      </div>

      {/* Agent A */}
      <AgentSlotCard
        label={agentALabel}
        onLabelChange={setAgentALabel}
        model={agentAModel}
        onModelChange={setAgentAModel}
        role={agentARole}
        onRoleChange={setAgentARole}
        color={agentAColor}
        onColorChange={setAgentAColor}
        dotLabel="A"
        settings={settings}
        providerModels={providerModels}
      />

      {/* Agent B */}
      <AgentSlotCard
        label={agentBLabel}
        onLabelChange={setAgentBLabel}
        model={agentBModel}
        onModelChange={setAgentBModel}
        role={agentBRole}
        onRoleChange={setAgentBRole}
        color={agentBColor}
        onColorChange={setAgentBColor}
        dotLabel="B"
        settings={settings}
        providerModels={providerModels}
      />

      {/* Collaboration Settings */}
      <div className="rounded-lg border border-border bg-[#111418] p-5 space-y-4">
        <h3 className="text-sm font-medium text-text-secondary">Collaboration</h3>

        {/* Mode */}
        <div className="flex items-center justify-between h-[40px]">
          <span className="text-[13px] text-text-primary">Mode</span>
          <div className="flex rounded-md border border-border overflow-hidden">
            <button
              type="button"
              onClick={() => setMode('sequential')}
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
              onClick={() => setMode('parallel')}
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
        </div>

        {/* Stop condition */}
        <div className="flex items-center justify-between h-[40px]">
          <span className="text-[13px] text-text-primary">Stop when</span>
          <div className="flex rounded-md border border-border overflow-hidden">
            <button
              type="button"
              onClick={() => setStopCondition('consensus')}
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
              onClick={() => setStopCondition('user-stop')}
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
        </div>

        {/* Max turns */}
        <div className="flex items-center justify-between h-[40px]">
          <span className="text-[13px] text-text-primary">Max turns</span>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={4}
              max={20}
              value={maxTurns}
              onChange={(e) => setMaxTurns(Number(e.target.value))}
              className="w-[120px] accent-accent"
            />
            <span className="text-[13px] text-text-secondary w-6 text-right">{maxTurns}</span>
          </div>
        </div>
      </div>
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
  color: AgentColor
  onColorChange: (color: AgentColor) => void
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
