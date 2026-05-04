import type { ThinkingLevel } from '@shared/types/settings'
import { ArrowUp, Loader2, Mic, Square } from 'lucide-react'
import { ModelSelector } from '@/components/shared/ModelSelector'
import { Popover } from '@/components/shared/Popover'
import { useSelectedModelThinkingLevel } from '@/hooks/useSelectedModelThinkingLevel'
import { cn } from '@/lib/cn'
import { useComposerStore } from '@/stores/composer-store'
import { usePreferencesStore } from '@/stores/preferences-store'
import { useProviderStore } from '@/stores/provider-store'
import { ComposerAttachButton } from './ComposerAttachButton'
import { ContextMeter } from './ContextMeter'

const THINKING_LEVEL_LABEL: Record<ThinkingLevel, string> = {
  off: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High',
}

function hasOnlyOffThinkingLevel(levels: readonly ThinkingLevel[]): boolean {
  return levels.length === 1 && levels[0] === 'off'
}

interface ComposerToolbarProps {
  onSend: () => void
  onCancel: () => void
  isLoading: boolean
  canSend: boolean
  onToggleVoice: () => void
  voiceMode: 'idle' | 'recording' | 'transcribing'
  fileInputRef: React.RefObject<HTMLInputElement | null>
  sendTitle?: string
}

export function ComposerToolbar({
  onSend,
  onCancel,
  isLoading,
  canSend,
  onToggleVoice,
  voiceMode,
  fileInputRef,
  sendTitle,
}: ComposerToolbarProps) {
  const settings = usePreferencesStore((s) => s.settings)
  const providerModels = useProviderStore((s) => s.providerModels)
  const setSelectedModel = usePreferencesStore((s) => s.setSelectedModel)
  const setThinkingLevel = usePreferencesStore((s) => s.setThinkingLevel)

  const thinkingMenuOpen = useComposerStore((s) => s.thinkingMenuOpen)
  const openMenu = useComposerStore((s) => s.openMenu)
  const {
    requestedThinkingLevel,
    effectiveThinkingLevel,
    availableThinkingLevels,
    capabilitiesKnown,
    isAdjustedForModel,
  } = useSelectedModelThinkingLevel()

  const isListening = voiceMode === 'recording'
  const isTranscribingVoice = voiceMode === 'transcribing'

  const hasSelectedModel = settings.selectedModel.trim().length > 0
  const canOpenThinkingMenu = capabilitiesKnown && availableThinkingLevels.length > 0
  const selectedModelOnlySupportsOff =
    capabilitiesKnown && hasOnlyOffThinkingLevel(availableThinkingLevels)
  const thinkingButtonLabel =
    hasSelectedModel && capabilitiesKnown
      ? THINKING_LEVEL_LABEL[effectiveThinkingLevel]
      : 'Thinking…'
  const thinkingButtonTitle = !hasSelectedModel
    ? 'Select a model before choosing thinking level'
    : !capabilitiesKnown
      ? 'Loading thinking capabilities for the selected model'
      : selectedModelOnlySupportsOff
        ? 'Selected model does not support thinking'
        : isAdjustedForModel
          ? `${THINKING_LEVEL_LABEL[requestedThinkingLevel]} is not available for this model; using ${THINKING_LEVEL_LABEL[effectiveThinkingLevel]}`
          : 'Select thinking level'

  async function handleThinkingLevelChange(level: ThinkingLevel): Promise<void> {
    openMenu(null)
    if (level === settings.thinkingLevel) return
    await setThinkingLevel(level)
  }

  return (
    <div className="flex items-center justify-between h-11 px-4">
      <div className="flex items-center gap-1.5">
        <ComposerAttachButton fileInputRef={fileInputRef} />

        <ModelSelector
          value={settings.selectedModel}
          onChange={setSelectedModel}
          settings={settings}
          providerModels={providerModels}
        />

        <Popover
          open={thinkingMenuOpen && canOpenThinkingMenu}
          onOpenChange={(open) => openMenu(open && canOpenThinkingMenu ? 'thinking' : null)}
          placement="top-start"
          className="min-w-[140px] py-1"
          trigger={
            <button
              type="button"
              onClick={() => openMenu(thinkingMenuOpen || !canOpenThinkingMenu ? null : 'thinking')}
              disabled={!canOpenThinkingMenu}
              className={cn(
                'flex items-center gap-[5px] h-[26px] px-2.5 rounded-md border border-button-border transition-colors',
                canOpenThinkingMenu ? 'hover:bg-bg-hover' : 'cursor-not-allowed opacity-70',
              )}
              title={thinkingButtonTitle}
            >
              <span className="text-[12px] text-text-secondary">{thinkingButtonLabel}</span>
              <span className="text-[9px] text-text-tertiary">&#x2228;</span>
            </button>
          }
        >
          {availableThinkingLevels.map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => {
                void handleThinkingLevelChange(level)
              }}
              className={cn(
                'flex w-full items-center justify-between px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-bg-hover',
                effectiveThinkingLevel === level ? 'text-accent' : 'text-text-secondary',
              )}
            >
              <span>{THINKING_LEVEL_LABEL[level]}</span>
              {effectiveThinkingLevel === level && <span>•</span>}
            </button>
          ))}
        </Popover>
      </div>

      <div className="flex items-center gap-2">
        <ContextMeter />

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

        {isLoading && (
          <button
            type="button"
            onClick={onCancel}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-error/35 bg-error/10 text-error transition-colors hover:bg-error/18"
            title="Cancel"
          >
            <Square className="h-3.5 w-3.5" />
          </button>
        )}
        {isLoading ? (
          <button
            type="button"
            onClick={onSend}
            disabled={!canSend}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-full transition-colors',
              canSend
                ? 'border border-accent/35 bg-accent/10 text-accent hover:bg-accent/18'
                : 'border border-border bg-bg-tertiary cursor-not-allowed',
            )}
            title={sendTitle ?? 'Add message'}
          >
            <ArrowUp className={cn('h-4 w-4', canSend ? 'text-accent' : 'text-text-muted')} />
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
            title={sendTitle ?? 'Send message'}
          >
            <ArrowUp className={cn('h-4 w-4', canSend ? 'text-bg' : 'text-text-muted')} />
          </button>
        )}
      </div>
    </div>
  )
}
