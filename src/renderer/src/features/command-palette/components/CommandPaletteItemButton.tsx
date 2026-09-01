import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import type { CommandPaletteItem } from '../model'

interface CommandPaletteItemButtonProps {
  readonly item: CommandPaletteItem
  readonly highlighted: boolean
  readonly index: number
  readonly onHighlightIndexChange: (index: number) => void
}

export function CommandPaletteItemButton({
  item,
  highlighted,
  index,
  onHighlightIndexChange,
}: CommandPaletteItemButtonProps) {
  return (
    <Button
      variant="unstyled"
      type="button"
      role="menuitem"
      disabled={item.disabled}
      aria-disabled={item.disabled}
      data-highlighted={highlighted}
      onClick={item.action}
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={() => onHighlightIndexChange(index)}
      className={cn(
        'flex h-10 w-full items-center gap-2.5 px-3.5 text-left transition-colors',
        highlighted
          ? 'bg-bg-tertiary text-text-primary'
          : 'text-text-secondary hover:bg-bg-tertiary/50',
        item.disabled && 'cursor-not-allowed opacity-60 hover:bg-transparent',
      )}
    >
      <span className={cn('shrink-0', highlighted ? 'text-text-primary' : 'text-text-muted')}>
        {item.icon}
      </span>
      <span className="shrink-0 text-sm font-medium">{item.label}</span>
      {item.description ? (
        <span className="truncate text-xs text-text-muted">{item.description}</span>
      ) : null}
      <CommandPaletteTrailingContent item={item} />
    </Button>
  )
}

interface CommandPaletteTrailingContentProps {
  readonly item: CommandPaletteItem
}

function CommandPaletteTrailingContent({ item }: CommandPaletteTrailingContentProps) {
  if (!item.trailing && !item.trailingBadge) return null

  return (
    <span className="ml-auto flex shrink-0 items-center gap-2">
      {item.trailingBadge ? (
        <span className="rounded-full bg-bg-tertiary px-1.5 py-0.5 text-xs font-medium text-text-muted">
          {item.trailingBadge}
        </span>
      ) : null}
      {item.trailing ? <span className="text-xs text-text-muted">{item.trailing}</span> : null}
    </span>
  )
}
