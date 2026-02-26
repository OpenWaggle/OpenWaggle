import type { QualityPreset } from '@shared/types/settings'
import { ArrowUp, Loader2, Mic, Plus, Square } from 'lucide-react'
import { ModelSelector } from '@/components/shared/ModelSelector'
import { Popover } from '@/components/shared/Popover'
import { useProject } from '@/hooks/useProject'
import { cn } from '@/lib/cn'
import { useComposerStore } from '@/stores/composer-store'
import { usePreferencesStore } from '@/stores/preferences-store'
import { useProviderStore } from '@/stores/provider-store'

const QUALITY_PRESET_LABEL: Record<QualityPreset, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}

interface ComposerToolbarProps {
  onSend: () => void
  onCancel: () => void
  isLoading: boolean
  canSend: boolean
  onToggleVoice: () => void
  fileInputRef: React.RefObject<HTMLInputElement | null>
}

export function ComposerToolbar({
  onSend,
  onCancel,
  isLoading,
  canSend,
  onToggleVoice,
  fileInputRef,
}: ComposerToolbarProps): React.JSX.Element {
  const { projectPath } = useProject()
  const settings = usePreferencesStore((s) => s.settings)
  const providerModels = useProviderStore((s) => s.providerModels)
  const setDefaultModel = usePreferencesStore((s) => s.setDefaultModel)
  const setQualityPreset = usePreferencesStore((s) => s.setQualityPreset)

  const qualityMenuOpen = useComposerStore((s) => s.qualityMenuOpen)
  const openMenu = useComposerStore((s) => s.openMenu)
  const isListening = useComposerStore((s) => s.isListening)
  const isTranscribingVoice = useComposerStore((s) => s.isTranscribingVoice)

  async function handleQualityChange(preset: QualityPreset): Promise<void> {
    openMenu(null)
    if (preset === settings.qualityPreset) return
    await setQualityPreset(preset)
  }

  return (
    <div className="flex items-center justify-between h-11 px-4">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={!projectPath}
          className={cn(
            'flex items-center justify-center h-6 w-6 rounded-md border border-button-border text-text-tertiary transition-colors',
            projectPath
              ? 'hover:bg-bg-hover hover:text-text-secondary'
              : 'cursor-not-allowed opacity-60',
          )}
          title={projectPath ? 'Attach files' : 'Select a project first'}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>

        <ModelSelector
          value={settings.defaultModel}
          onChange={setDefaultModel}
          settings={settings}
          providerModels={providerModels}
        />

        <Popover
          open={qualityMenuOpen}
          onOpenChange={(open) => openMenu(open ? 'quality' : null)}
          placement="top-start"
          className="min-w-[140px] py-1"
          trigger={
            <button
              type="button"
              onClick={() => openMenu(qualityMenuOpen ? null : 'quality')}
              className="flex items-center gap-[5px] h-[26px] px-2.5 rounded-md border border-button-border transition-colors hover:bg-bg-hover"
              title="Select quality preset"
            >
              <span className="text-[12px] text-text-secondary">
                {QUALITY_PRESET_LABEL[settings.qualityPreset]}
              </span>
              <span className="text-[9px] text-text-tertiary">&#x2228;</span>
            </button>
          }
        >
          {(['low', 'medium', 'high'] as const).map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => {
                void handleQualityChange(preset)
              }}
              className={cn(
                'flex w-full items-center justify-between px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-bg-hover',
                settings.qualityPreset === preset ? 'text-accent' : 'text-text-secondary',
              )}
            >
              <span>{QUALITY_PRESET_LABEL[preset]}</span>
              {settings.qualityPreset === preset && <span>•</span>}
            </button>
          ))}
        </Popover>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggleVoice}
          disabled={isTranscribingVoice}
          className={cn(
            'flex items-center justify-center h-5 w-5 transition-colors',
            isTranscribingVoice
              ? 'cursor-not-allowed text-text-tertiary'
              : isListening
                ? 'text-accent'
                : 'text-text-secondary hover:text-text-primary',
          )}
          title={
            isTranscribingVoice
              ? 'Transcribing audio'
              : isListening
                ? 'Stop voice input'
                : 'Start voice input'
          }
        >
          {isTranscribingVoice ? (
            <Loader2 className="h-[15px] w-[15px] animate-spin" />
          ) : (
            <Mic className="h-[15px] w-[15px]" />
          )}
        </button>

        {isLoading ? (
          <button
            type="button"
            onClick={onCancel}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-error/35 bg-error/10 text-error transition-colors hover:bg-error/18"
            title="Cancel"
          >
            <Square className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onSend}
            disabled={!canSend}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-full transition-colors',
              canSend
                ? 'bg-gradient-to-b from-accent to-accent-dim'
                : 'border border-border bg-bg-tertiary cursor-not-allowed',
            )}
            title="Send message"
          >
            <ArrowUp className={cn('h-4 w-4', canSend ? 'text-bg' : 'text-text-muted')} />
          </button>
        )}
      </div>
    </div>
  )
}
