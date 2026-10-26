import { ChevronDown, ChevronRight } from 'lucide-react'
import { SessionTitleInput, useSessionTitleRename } from '@/features/session-title'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import type { HiveTreeItem, HiveTreeRollUp } from '../lib/hive-tree-structure'
import {
  HIVE_ROW_GRID_STYLE,
  HivePinnedBadge,
  HiveRowGlyphs,
  HiveRowMenu,
  HiveRowTitle,
  HiveStateCell,
  HiveWorkspaceCell,
  hiveRowAccessibleName,
  useHiveRowView,
  useRowMenu,
} from './HiveRowParts'

/** One indentation step of the tree, in pixels (inline for the same reason as the grid). */
const INDENT_STEP_PX = 14
/** Lines the disclosure chevron up with the title's first line. */
const DISCLOSURE_OFFSET_PX = 2

/** What a tree row does; the tree owns focus and the keyboard model. */
export interface HiveTreeItemActions {
  readonly onOpen: () => void
  readonly onToggle: () => void
  readonly onFocusItem: () => void
  /** The tree's keyboard model; it acts only on keys pressed on a row itself. */
  readonly onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void
}

function isOwnEvent(event: React.SyntheticEvent<HTMLElement>) {
  return event.target instanceof Node && event.currentTarget.contains(event.target)
}

function workersLabel(count: number) {
  return `${String(count)} ${count === 1 ? 'Worker' : 'Workers'}`
}

function rollUpParts(rollUp: HiveTreeRollUp | null) {
  if (rollUp === null) return []
  return [
    ...(rollUp.needsAttention > 0
      ? [
          `${String(rollUp.needsAttention)} ${rollUp.needsAttention === 1 ? 'needs' : 'need'} attention`,
        ]
      : []),
    ...(rollUp.readyForReview > 0 ? [`${String(rollUp.readyForReview)} ready for review`] : []),
  ]
}

/** What a row says about the rows below it, visibly and in its accessible name. */
function rowMeta(item: HiveTreeItem) {
  return [
    ...(item.childCount > 0 ? [workersLabel(item.childCount)] : []),
    ...(item.archivedCount > 0 ? [`${String(item.archivedCount)} archived`] : []),
    ...rollUpParts(item.rollUp),
  ]
}

/**
 * One row of the Hive panel's tree (#377): a WAI-ARIA `treeitem` in a flat tree, indented by
 * depth up to four levels, with a disclosure when it has children. A collapsed row rolls up the
 * live descendants that need the user. The row keeps its own state, Workspace and ⋯ menu.
 */
export function HiveTreeItemRow({
  item,
  domId,
  isCurrent,
  tabbable,
  actions,
}: {
  readonly item: HiveTreeItem
  readonly domId: string
  readonly isCurrent: boolean
  /** The one row in the tab order (roving tabindex). */
  readonly tabbable: boolean
  readonly actions: HiveTreeItemActions
}) {
  const { onOpen, onToggle, onFocusItem, onKeyDown } = actions
  const view = useHiveRowView(item.session, item.isRoot)
  const menu = useRowMenu()
  const rename = useSessionTitleRename(view.sessionId, view.session.title)
  const meta = rowMeta(item)

  return (
    <div
      id={domId}
      role="treeitem"
      aria-level={item.level}
      aria-setsize={item.setSize}
      aria-posinset={item.posInSet}
      aria-expanded={item.expanded === null ? undefined : item.expanded}
      aria-current={isCurrent ? 'true' : undefined}
      aria-label={hiveRowAccessibleName(view, item.parentTitle, meta)}
      tabIndex={tabbable ? 0 : -1}
      data-dimmed={item.dimmed ? 'true' : undefined}
      className={cn(
        'group relative rounded-md outline-none transition-colors hover:bg-bg-hover focus-visible:bg-bg-hover',
        item.dimmed && 'opacity-60',
      )}
      onFocus={(event) => {
        if (event.target === event.currentTarget) onFocusItem()
      }}
      // The ⋯ menu renders in a portal, and React bubbles its events here: act only on events
      // from the row's own DOM.
      onClick={(event) => {
        if (!rename.isEditing && isOwnEvent(event)) onOpen()
      }}
      onContextMenu={(event) => {
        if (isOwnEvent(event)) menu.openAtPointer(event)
      }}
      onKeyDown={onKeyDown}
    >
      <div className="min-h-9 py-1.5 pr-9 pl-2" style={HIVE_ROW_GRID_STYLE}>
        <span
          className="flex min-w-0 items-start gap-1.5"
          style={{ paddingLeft: item.indent * INDENT_STEP_PX }}
        >
          <HiveTreeDisclosure item={item} onToggle={onToggle} />
          <span className="flex h-5 shrink-0 items-center gap-1.5">
            <HiveRowGlyphs view={view} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            {rename.isEditing ? (
              <SessionTitleInput rename={rename} className="text-sm" />
            ) : (
              <HiveRowTitle view={view} />
            )}
            <HiveTreeItemMeta item={item} meta={meta} />
          </span>
          <HiveTreeDepthBadge badge={item.depthBadge} />
          <HivePinnedBadge view={view} />
        </span>
        <HiveWorkspaceCell view={view} />
        <HiveStateCell view={view} />
      </div>
      {rename.isEditing ? null : (
        <HiveRowMenu view={view} menu={menu} onRename={rename.start} buttonClassName="top-2" />
      )}
    </div>
  )
}

/**
 * The tree connector and, for a row with children, its disclosure. Out of the tab order: arrow
 * keys expand and collapse the focused row; the control is for the pointer.
 */
function HiveTreeDisclosure({
  item,
  onToggle,
}: {
  readonly item: HiveTreeItem
  readonly onToggle: () => void
}) {
  if (item.expanded === null) {
    return item.depth === 0 ? (
      <span aria-hidden="true" className="w-4 shrink-0" />
    ) : (
      <span
        aria-hidden="true"
        className="mt-1 ml-1.5 h-2 w-2.5 shrink-0 rounded-bl border-b border-l border-border"
      />
    )
  }
  const Icon = item.expanded ? ChevronDown : ChevronRight
  return (
    <Button
      variant="unstyled"
      tabIndex={-1}
      aria-label={`${item.expanded ? 'Collapse' : 'Expand'} ${item.session.title}`}
      className="flex size-4 shrink-0 items-center justify-center rounded text-text-muted hover:text-text-secondary"
      style={{ marginTop: DISCLOSURE_OFFSET_PX }}
      onClick={(event) => {
        event.stopPropagation()
        onToggle()
        // Keep focus on the row, where the tree's keys work, not on this pointer-only control.
        event.currentTarget.closest<HTMLElement>('[role="treeitem"]')?.focus()
      }}
    >
      <Icon aria-hidden="true" className="size-3.5" />
    </Button>
  )
}

/** "n Workers · n archived", a roll-up dot for a collapsed row, and an orphan's parent. */
function HiveTreeItemMeta({
  item,
  meta,
}: {
  readonly item: HiveTreeItem
  readonly meta: readonly string[]
}) {
  if (meta.length === 0 && item.orphanParentTitle === null) return null
  const attention = (item.rollUp?.needsAttention ?? 0) > 0
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-text-tertiary">
      {item.rollUp === null ? null : (
        <span
          aria-hidden="true"
          className={cn('size-1.5 shrink-0 rounded-full', attention ? 'bg-warning' : 'bg-info')}
        />
      )}
      {/* A separator ends the part before it, so a wrapped line never starts with one. */}
      {meta.map((part, index) => (
        <span key={part} className="flex items-center gap-x-1.5 whitespace-nowrap">
          <span>{part}</span>
          {index < meta.length - 1 ? <span aria-hidden="true">·</span> : null}
        </span>
      ))}
      {item.orphanParentTitle === null ? null : (
        <span className="truncate">Spawned by {item.orphanParentTitle} (not loaded)</span>
      )}
    </span>
  )
}

/** Rows deeper than the indentation cap name their depth instead. */
function HiveTreeDepthBadge({ badge }: { readonly badge: string | null }) {
  if (badge === null) return null
  return (
    <span className="shrink-0 rounded border border-border-light px-1 text-xs text-text-tertiary tabular-nums">
      {badge}
    </span>
  )
}
