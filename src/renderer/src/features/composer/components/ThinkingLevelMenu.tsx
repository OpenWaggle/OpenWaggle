import type { ThinkingLevel } from '@shared/types/settings'
import { useComposerStore } from '@/features/composer/state/composer-store'
import { useSelectedModelThinkingLevel } from '@/features/providers/hooks'
import { usePreferencesStore } from '@/features/settings/state'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { Popover } from '@/shared/ui/Popover'
import { THINKING_LEVEL_LABELS } from '../constants/thinking-level-labels'
import {
  getThinkingButtonLabel,
  getThinkingButtonTitle,
  hasOnlyOffThinkingLevel,
} from '../lib/thinking-level-view'

export function ThinkingLevelMenu() {
  const settings = usePreferencesStore((s) => s.settings)
  const setThinkingLevel = usePreferencesStore((s) => s.setThinkingLevel)
  const thinkingMenuOpen = useComposerStore((s) => s.thinkingMenuOpen)
  const openMenu = useComposerStore((s) => s.openMenu)
  const thinking = useSelectedModelThinkingLevel()
  const hasSelectedModel = settings.selectedModel.trim().length > 0
  const canOpenThinkingMenu =
    thinking.capabilitiesKnown && thinking.availableThinkingLevels.length > 0
  const selectedModelOnlySupportsOff =
    thinking.capabilitiesKnown && hasOnlyOffThinkingLevel(thinking.availableThinkingLevels)

  async function handleThinkingLevelChange(level: ThinkingLevel) {
    openMenu(null)
    if (level === settings.thinkingLevel) return
    await setThinkingLevel(level)
  }

  return (
    <Popover
      open={thinkingMenuOpen && canOpenThinkingMenu}
      onOpenChange={(open) => openMenu(open && canOpenThinkingMenu ? 'thinking' : null)}
      placement="top-start"
      className="min-w-[140px] py-1"
      trigger={
        <ThinkingLevelTrigger
          open={thinkingMenuOpen}
          canOpen={canOpenThinkingMenu}
          label={getThinkingButtonLabel(
            hasSelectedModel,
            thinking.capabilitiesKnown,
            thinking.effectiveThinkingLevel,
          )}
          title={getThinkingButtonTitle({
            hasSelectedModel,
            capabilitiesKnown: thinking.capabilitiesKnown,
            selectedModelOnlySupportsOff,
            isAdjustedForModel: thinking.isAdjustedForModel,
            requestedThinkingLevel: thinking.requestedThinkingLevel,
            effectiveThinkingLevel: thinking.effectiveThinkingLevel,
          })}
          onToggle={(nextOpen) => openMenu(nextOpen ? 'thinking' : null)}
        />
      }
    >
      <ThinkingLevelOptions
        levels={thinking.availableThinkingLevels}
        effectiveThinkingLevel={thinking.effectiveThinkingLevel}
        onSelect={(level) => {
          void handleThinkingLevelChange(level)
        }}
      />
    </Popover>
  )
}

interface ThinkingLevelTriggerProps {
  readonly open: boolean
  readonly canOpen: boolean
  readonly label: string
  readonly title: string
  readonly onToggle: (open: boolean) => void
}

function ThinkingLevelTrigger({
  open,
  canOpen,
  label,
  title,
  onToggle,
}: ThinkingLevelTriggerProps) {
  return (
    <Button
      variant="unstyled"
      type="button"
      onClick={() => onToggle(!open && canOpen)}
      disabled={!canOpen}
      className={cn(
        'flex h-[26px] items-center gap-[5px] rounded-md border border-button-border px-2.5 transition-colors',
        canOpen ? 'hover:bg-bg-hover' : 'cursor-not-allowed opacity-70',
      )}
      title={title}
    >
      <span className="text-[12px] text-text-secondary">{label}</span>
      <span className="text-[9px] text-text-tertiary">&#x2228;</span>
    </Button>
  )
}

interface ThinkingLevelOptionsProps {
  readonly levels: readonly ThinkingLevel[]
  readonly effectiveThinkingLevel: ThinkingLevel
  readonly onSelect: (level: ThinkingLevel) => void
}

function ThinkingLevelOptions({
  levels,
  effectiveThinkingLevel,
  onSelect,
}: ThinkingLevelOptionsProps) {
  return levels.map((level) => (
    <Button
      variant="unstyled"
      key={level}
      type="button"
      onClick={() => onSelect(level)}
      className={cn(
        'flex w-full items-center justify-between px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-bg-hover',
        effectiveThinkingLevel === level ? 'text-accent' : 'text-text-secondary',
      )}
    >
      <span>{THINKING_LEVEL_LABELS[level]}</span>
      {effectiveThinkingLevel === level ? <span>•</span> : null}
    </Button>
  ))
}
