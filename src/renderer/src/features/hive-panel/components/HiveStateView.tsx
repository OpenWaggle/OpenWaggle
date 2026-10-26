import { ChevronDown, ChevronRight } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { HIVE_DELEGATION_GROUP_LABELS } from '@/queries/session-hive-contract'
import { Button } from '@/shared/ui/Button'
import type { HiveTreeModel, HiveTreeRow } from '../lib/hive-tree-model'
import { HIVE_ROW_GRID_STYLE, HIVE_ROW_ID_ATTRIBUTE, HiveTreeListItem } from './HiveTreeRow'

/** A count of the Hive's loaded pages; `+` says more Workers are still unread. */
export function loadedCount(count: number, partial: boolean) {
  return partial ? `${String(count)}+` : String(count)
}

/**
 * The one column header over the whole list (ADR 0051 review): it anchors the Workspace and
 * State cells so they read as columns, not stray words. Rows and this header share one grid;
 * the header's padding matches the rows', actions gutter included, so the columns line up.
 */
export function HiveColumnHeader() {
  return (
    // Visual only: every row's accessible name already carries its Workspace and state.
    <div
      aria-hidden="true"
      className="pt-1 pr-9 pb-1 pl-2 text-xs font-semibold uppercase tracking-wide text-text-muted"
      style={HIVE_ROW_GRID_STYLE}
    >
      <span>Session</span>
      <span className="text-right" title="Workspace: the checkout or worktree each Session runs in">
        Workspace
      </span>
      <span className="text-right" title="State: where each Session's Delegation or Run stands">
        State
      </span>
    </div>
  )
}

interface StateViewRows {
  readonly onOpen: (sessionId: string) => void
  readonly onSelectParent: (parentId: string) => void
  readonly currentSessionId: string | null
  readonly partial: boolean
}

/**
 * The Hive panel's By state view (ADR 0051, #356, #377): the Queen, then the members grouped by
 * Delegation state. A row below the first level links to its parent; selecting the link moves
 * focus to the parent's row.
 */
export function HiveStateView({
  model,
  currentSessionId,
  partial,
  onOpen,
}: {
  readonly model: HiveTreeModel
  readonly currentSessionId: string | null
  readonly partial: boolean
  readonly onOpen: (sessionId: string) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const root = model.root

  function selectParent(parentId: string) {
    const rows = listRef.current?.querySelectorAll<HTMLElement>(`[${HIVE_ROW_ID_ATTRIBUTE}]`) ?? []
    const parentRow = [...rows].find((row) => row.getAttribute(HIVE_ROW_ID_ATTRIBUTE) === parentId)
    // Focusing scrolls the row into view.
    parentRow?.focus()
  }

  const shared: StateViewRows = { onOpen, onSelectParent: selectParent, currentSessionId, partial }
  return (
    <div ref={listRef}>
      {root !== null ? (
        <HiveTreeListItem
          row={{ session: root, parent: null }}
          isCurrent={currentSessionId !== null && String(root.id) === currentSessionId}
          onOpen={() => onOpen(String(root.id))}
          isRoot
        />
      ) : null}
      <HiveTreeGroup
        label={HIVE_DELEGATION_GROUP_LABELS['needs-attention']}
        rows={model.groups.needsAttention}
        shared={shared}
      />
      <HiveTreeGroup
        label={HIVE_DELEGATION_GROUP_LABELS['ready-for-review']}
        rows={model.groups.readyForReview}
        shared={shared}
      />
      <HiveTreeGroup
        label={HIVE_DELEGATION_GROUP_LABELS.active}
        rows={model.groups.active}
        shared={shared}
      />
      <HiveTreeGroup
        label={HIVE_DELEGATION_GROUP_LABELS.closed}
        rows={model.groups.closed}
        shared={shared}
      />
      <HiveArchivedGroup
        // Its open state belongs to one Hive: moving within the Hive keeps it, another resets it.
        key={String(root?.id ?? '')}
        rows={model.groups.archived}
        shared={shared}
      />
    </div>
  )
}

function HiveStateRows({
  rows,
  shared,
}: {
  readonly rows: readonly HiveTreeRow[]
  readonly shared: StateViewRows
}) {
  return rows.map((row) => (
    <HiveTreeListItem
      key={String(row.session.id)}
      row={row}
      isCurrent={
        shared.currentSessionId !== null && String(row.session.id) === shared.currentSessionId
      }
      onOpen={() => shared.onOpen(String(row.session.id))}
      onSelectParent={shared.onSelectParent}
    />
  ))
}

function HiveTreeGroup({
  label,
  rows,
  shared,
}: {
  readonly label: string
  readonly rows: readonly HiveTreeRow[]
  readonly shared: StateViewRows
}) {
  if (rows.length === 0) return null
  return (
    <fieldset aria-label={`${label} Hive sessions`} className="m-0 min-w-0 border-0 p-0">
      <div className="flex items-baseline gap-1.5 px-2 pb-0.5 pt-1 text-xs font-medium tracking-wide text-text-muted uppercase">
        <span>{label}</span>
        <span className="tabular-nums">{loadedCount(rows.length, shared.partial)}</span>
      </div>
      <HiveStateRows rows={rows} shared={shared} />
    </fieldset>
  )
}

function HiveArchivedGroup({
  rows,
  shared,
}: {
  readonly rows: readonly HiveTreeRow[]
  readonly shared: StateViewRows
}) {
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  if (rows.length === 0) return null
  return (
    <div>
      <Button
        variant="unstyled"
        className="flex min-h-7 items-center gap-1 rounded px-2 text-xs font-medium text-text-muted transition-colors hover:bg-bg-hover hover:text-text-secondary"
        // The visible text is the name, so the count reaches screen readers; aria-expanded says
        // whether the group is open.
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => setExpanded((current) => !current)}
      >
        {expanded ? (
          <ChevronDown aria-hidden="true" className="size-3" />
        ) : (
          <ChevronRight aria-hidden="true" className="size-3" />
        )}
        Archived · {loadedCount(rows.length, shared.partial)}
      </Button>
      {/* The list stays in the DOM, hidden while collapsed, so aria-controls always resolves;
          its rows mount only when shown. The toggle row is its only visible label. */}
      <fieldset
        id={listId}
        hidden={!expanded}
        aria-label="Archived Hive sessions"
        className="m-0 min-w-0 border-0 p-0"
      >
        {expanded ? <HiveStateRows rows={rows} shared={shared} /> : null}
      </fieldset>
    </div>
  )
}
