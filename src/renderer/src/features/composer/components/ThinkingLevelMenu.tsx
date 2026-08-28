import type { ThinkingLevel } from '@shared/types/settings'
import { Check, ChevronDown, Ellipsis } from 'lucide-react'
import { useComposerStore } from '@/features/composer/state/composer-store'
import { useSelectedModelThinkingLevel } from '@/features/providers/hooks'
import { usePreferencesStore } from '@/features/settings/state'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { DENSE_MENU_ITEM_CLASS } from '@/shared/ui/menu-styles'
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
      className="min-w-40 p-1.5"
      role="menu"
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
      aria-label={`Thinking level: ${label}`}
      variant="unstyled"
      type="button"
      onClick={() => onToggle(!open && canOpen)}
      disabled={!canOpen}
      className={cn(
        'flex h-6.5 items-center gap-1.5 rounded-md border border-button-border px-2.5 transition-colors @max-xl/composer-toolbar:size-6.5 @max-xl/composer-toolbar:justify-center @max-xl/composer-toolbar:gap-0 @max-xl/composer-toolbar:px-0',
        canOpen ? 'hover:bg-bg-hover' : 'cursor-not-allowed opacity-70',
      )}
      title={title}
    >
      <span className="text-xs text-text-secondary @max-xl/composer-toolbar:hidden">{label}</span>
      <ChevronDown
        aria-hidden="true"
        className="size-3 text-text-tertiary @max-xl/composer-toolbar:hidden"
      />
      <Ellipsis
        aria-hidden="true"
        className="hidden size-3.5 text-text-tertiary @max-xl/composer-toolbar:block"
        data-testid="composer-thinking-compact-icon"
      />
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
      role="menuitemradio"
      aria-checked={effectiveThinkingLevel === level}
      className={cn(
        DENSE_MENU_ITEM_CLASS,
        'min-h-8 justify-between py-1 text-xs',
        effectiveThinkingLevel === level ? 'bg-bg-active text-text-primary' : 'text-text-secondary',
      )}
    >
      <span>{THINKING_LEVEL_LABELS[level]}</span>
      {effectiveThinkingLevel === level ? (
        <Check aria-hidden="true" className="size-3.5 text-accent" />
      ) : null}
    </Button>
  ))
}
