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
      data-highlighted={highlighted}
      onClick={item.action}
      onMouseEnter={() => onHighlightIndexChange(index)}
      className={cn(
        'flex h-10 w-full items-center gap-2.5 px-3.5 text-left transition-colors',
        highlighted
          ? 'bg-[#1e2229] text-text-primary'
          : 'text-text-secondary hover:bg-[#1e2229]/50',
      )}
    >
      <span className={cn('shrink-0', highlighted ? 'text-text-primary' : 'text-text-muted')}>
        {item.icon}
      </span>
      <span className="shrink-0 text-[13px] font-medium">{item.label}</span>
      {item.description ? (
        <span className="truncate text-[12px] text-text-muted">{item.description}</span>
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
        <span className="rounded-full bg-[#1e2229] px-1.5 py-0.5 text-[10px] font-medium text-text-muted">
          {item.trailingBadge}
        </span>
      ) : null}
      {item.trailing ? <span className="text-[11px] text-text-muted">{item.trailing}</span> : null}
    </span>
  )
}
