import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { SESSION_TREE } from '../constants/session-tree'
import type { SessionTreeRow, SessionTreeRowGeometry } from '../model/session-tree-row'

interface SessionTreeNodeDotProps {
  readonly expanded: boolean
  readonly geometry: SessionTreeRowGeometry
  readonly highlighted: boolean
  readonly row: SessionTreeRow
  readonly onFocus: () => void
  readonly onToggle: () => void
}

export function SessionTreeNodeDot({
  expanded,
  geometry,
  highlighted,
  row,
  onFocus,
  onToggle,
}: SessionTreeNodeDotProps) {
  const style = {
    left: geometry.nodeCenterXPx - SESSION_TREE.LAYOUT.NODE_DOT_OFFSET_PX,
    width: SESSION_TREE.LAYOUT.NODE_DOT_SIZE_PX,
    height: SESSION_TREE.LAYOUT.NODE_DOT_SIZE_PX,
  }

  if (!row.hasExpandableChildren) {
    return (
      <span
        className={cn(
          'session-tree-node-dot absolute top-1/2 z-10 -translate-y-1/2 rounded-full border transition-[background-color,border-color,box-shadow,transform] duration-150 ease-out group-hover:scale-110',
          highlighted
            ? 'session-tree-active-dot border-accent bg-accent'
            : 'border-border-light bg-diff-bg group-hover:border-text-tertiary',
        )}
        style={style}
      />
    )
  }

  return (
    <Button
      variant="unstyled"
      type="button"
      aria-label={expanded ? 'Collapse tree node' : 'Expand tree node'}
      onFocus={onFocus}
      onClick={onToggle}
      className={cn(
        'session-tree-node-dot absolute top-1/2 z-10 flex -translate-y-1/2 items-center justify-center rounded-full border transition-[background-color,border-color,color,transform,box-shadow] duration-150 ease-out hover:scale-110 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent',
        highlighted
          ? 'session-tree-active-dot border-accent bg-accent text-bg'
          : 'border-border-light bg-diff-bg text-text-muted hover:border-accent/60 hover:bg-bg-hover hover:text-text-secondary',
      )}
      style={style}
    >
      {expanded ? (
        <ChevronDown className="size-2.5 opacity-80" />
      ) : (
        <ChevronRight className="size-2.5" />
      )}
    </Button>
  )
}
