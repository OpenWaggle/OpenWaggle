import { generateDisplayName } from '@shared/types/llm'
import type { WagglePreset } from '@shared/types/waggle'
import { Plus, Save, Trash2 } from 'lucide-react'
import { AGENT_BG } from '@/features/waggle/lib'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'

interface WagglePresetsPanelProps {
  presets: readonly WagglePreset[]
  activePresetId: string | null
  isModified: boolean
  onLoadPreset: (preset: WagglePreset) => void
  onDeletePreset: (id: string) => Promise<void>
  onSaveEdits: () => Promise<void>
  onNewCustom: () => Promise<void>
}

export function WagglePresetsPanel({
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
          <Button
            variant="unstyled"
            type="button"
            onClick={() => void onSaveEdits()}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-accent/30 bg-accent/5 p-2.5 text-[12px] font-medium text-accent hover:bg-accent/10 transition-colors"
          >
            <Save className="size-3" />
            Save Changes
          </Button>
        )}

        <Button
          variant="unstyled"
          type="button"
          onClick={() => void onNewCustom()}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-dashed border-border p-2.5 text-[12px] font-medium text-text-muted hover:border-border-light hover:text-text-secondary transition-colors"
        >
          <Plus className="size-3" />
          New Custom Preset
        </Button>
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
    <Button
      variant="unstyled"
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
            <div className={cn('size-1.5 rounded-full', AGENT_BG[preset.config.agents[0].color])} />
            <span className="truncate">{generateDisplayName(preset.config.agents[0].model)}</span>
            <span className="text-text-tertiary">vs</span>
            <div className={cn('size-1.5 rounded-full', AGENT_BG[preset.config.agents[1].color])} />
            <span className="truncate">{generateDisplayName(preset.config.agents[1].model)}</span>
          </div>
        </div>
        {!preset.isBuiltIn && (
          <span
            role="none"
            onClick={(event) => {
              event.stopPropagation()
              void onDelete()
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.stopPropagation()
                void onDelete()
              }
            }}
            className="p-1 rounded text-text-muted hover:text-error transition-colors cursor-pointer"
          >
            <Trash2 className="size-3" />
          </span>
        )}
      </div>
    </Button>
  )
}
