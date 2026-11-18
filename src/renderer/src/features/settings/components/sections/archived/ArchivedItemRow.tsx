import type { ArchivedItem } from '@shared/types/archived-items'
import { Eye, GitBranch, RotateCcw, Trash2 } from 'lucide-react'
import type { MouseEvent } from 'react'
import { cn } from '@/shared/lib/cn'
import { formatRelativeTime, projectName } from '@/shared/lib/format'
import { Button } from '@/shared/ui/Button'
import { Checkbox } from '@/shared/ui/Checkbox'
import { searchHighlightRanges } from '../../../lib/archived-items-view'
import { HighlightedText } from './HighlightedText'

export interface ArchivedItemRowActions {
  readonly toggle: (item: ArchivedItem, range: boolean) => void
  readonly restore: (item: ArchivedItem) => void
  readonly open: (item: ArchivedItem) => void
  readonly remove: (item: ArchivedItem) => void
}

interface ArchivedItemRowProps {
  readonly item: ArchivedItem
  readonly searchedText: string
  readonly selected: boolean
  /** The selection is full: this row can be deselected but not added. */
  readonly selectionFull: boolean
  readonly pending: boolean
  readonly actions: ArchivedItemRowActions
}

/**
 * The project, the session a branch belongs to, and the Archive time. Only the project and parent
 * title are highlighted: the search matched those, never the generated words around them.
 */
function MetaLine({
  item,
  searchedText,
}: {
  readonly item: ArchivedItem
  readonly searchedText: string
}) {
  const project = projectName(item.projectPath)
  const parent = item.ref.kind === 'branch' ? (item.parentTitle ?? 'a session') : null
  return (
    <p className="truncate text-xs text-text-muted">
      <HighlightedText text={project} ranges={searchHighlightRanges(project, searchedText)} />
      {parent === null ? null : (
        <>
          {' · Branch of '}
          <HighlightedText text={parent} ranges={searchHighlightRanges(parent, searchedText)} />
        </>
      )}
      {` · archived ${formatRelativeTime(item.archivedAt)}`}
    </p>
  )
}

/** One archived session or branch: select, restore, open, or (sessions only) delete. */
export function ArchivedItemRow({
  item,
  searchedText,
  selected,
  selectionFull,
  pending,
  actions,
}: ArchivedItemRowProps) {
  const isBranch = item.ref.kind === 'branch'

  return (
    <div
      data-qa="archived-item-row"
      className={cn(
        'group flex items-start gap-3 rounded-md border px-3 py-2 transition-colors',
        selected ? 'border-accent/30 bg-accent/8' : 'border-border hover:border-border-light',
      )}
    >
      <Checkbox
        checked={selected}
        readOnly
        disabled={!selected && selectionFull}
        aria-label={`Select ${item.title}`}
        className="mt-0.5"
        onClick={(event: MouseEvent<HTMLInputElement>) => actions.toggle(item, event.shiftKey)}
      />
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-1.5 text-xs text-text-secondary">
          {isBranch ? (
            <GitBranch aria-label="Branch" className="size-3 shrink-0 text-text-tertiary" />
          ) : null}
          <span className="truncate">
            <HighlightedText
              text={item.title}
              ranges={searchHighlightRanges(item.title, searchedText)}
            />
          </span>
        </p>
        <MetaLine item={item} searchedText={searchedText} />
        {item.snippet ? (
          <p className="mt-1 line-clamp-2 border-l-2 border-border-light pl-2 text-xs text-text-tertiary">
            <HighlightedText text={item.snippet.text} ranges={item.snippet.highlights} />
          </p>
        ) : null}
      </div>
      <div
        className={cn(
          'flex shrink-0 items-center gap-0.5 transition-opacity',
          selected
            ? 'opacity-100'
            : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100',
        )}
      >
        <Button
          type="button"
          variant="secondary"
          size="xs"
          disabled={pending}
          leftIcon={<RotateCcw aria-hidden="true" className="size-3.5" />}
          onClick={() => actions.restore(item)}
          aria-label={`Restore ${item.title}`}
        >
          Restore
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => actions.open(item)}
          aria-label={isBranch ? `Open the session of ${item.title}` : `Open ${item.title}`}
          title={isBranch ? 'Open session' : 'Open'}
        >
          <Eye aria-hidden="true" className="size-3.5" />
        </Button>
        {isBranch ? null : (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={pending}
            onClick={() => actions.remove(item)}
            aria-label={`Delete ${item.title} permanently`}
            title="Delete permanently"
            className="hover:text-error"
          >
            <Trash2 aria-hidden="true" className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  )
}
