import { SessionTitleInput, useSessionTitleRename } from '@/features/session-title'
import { Button } from '@/shared/ui/Button'
import type { HiveRowParent, HiveTreeRow } from '../lib/hive-tree-model'
import {
  HIVE_ROW_CLASS,
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

export { HIVE_ROW_GRID_STYLE } from './HiveRowParts'

/** The attribute the By state view finds a row by, to select a row's parent (#377). */
export const HIVE_ROW_ID_ATTRIBUTE = 'data-hive-row'
/**
 * One row of the Hive panel's By state view: state, Workspace placement, and the sidebar's own ⋯
 * menu (ADR 0051). A row below the first level names its parent as a link that selects the
 * parent's row, and its tooltip shows the whole chain from the Queen (#377).
 *
 * The menu is the same `SessionItemContextMenu` the sidebar renders, registered by the Sidebar,
 * so every action behaves identically in both places. Rename edits the title in place, as in the
 * sidebar; an archived row offers Unarchive instead of Archive, and Move up / Move down stay
 * Pinned-only.
 */
export function HiveTreeListItem({
  row,
  isCurrent,
  onOpen,
  onSelectParent,
  isRoot = false,
}: {
  readonly row: HiveTreeRow
  readonly isCurrent: boolean
  readonly onOpen: () => void
  readonly onSelectParent?: (parentId: string) => void
  /** The hive root is the Queen even when it has no lineage row of its own (ADR 0030). */
  readonly isRoot?: boolean
}) {
  const view = useHiveRowView(row.session, isRoot)
  const menu = useRowMenu()
  const rename = useSessionTitleRename(view.sessionId, view.session.title)
  const parent = row.parent
  // The whole chain from the Queen, this row included: `Queen › Worker › Worker`.
  const ancestry =
    parent === null ? undefined : [...parent.ancestry, view.session.title].join(' › ')

  return (
    <div className="group relative">
      {rename.isEditing ? (
        // An input cannot live inside the row's button, so the editing row is a plain grid.
        <div className={HIVE_ROW_CLASS} style={HIVE_ROW_GRID_STYLE}>
          <span className="flex min-w-0 items-center">
            <SessionTitleInput rename={rename} className="text-sm" />
          </span>
          <HiveWorkspaceCell view={view} />
          <HiveStateCell view={view} />
        </div>
      ) : (
        <Button
          ref={rename.returnFocusRef}
          type="button"
          variant="unstyled"
          className={HIVE_ROW_CLASS}
          style={HIVE_ROW_GRID_STYLE}
          data-hive-row={String(view.session.id)}
          title={ancestry}
          aria-current={isCurrent ? 'true' : undefined}
          aria-label={hiveRowAccessibleName(view, parent?.title ?? null)}
          onClick={onOpen}
          onContextMenu={menu.openAtPointer}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <HiveRowGlyphs view={view} />
            <span className="flex min-w-0 flex-1 flex-col">
              <HiveRowTitle view={view} />
            </span>
            <HivePinnedBadge view={view} />
          </span>
          <HiveWorkspaceCell view={view} />
          <HiveStateCell view={view} />
        </Button>
      )}
      {rename.isEditing ? null : <HiveSpawnedBy parent={parent} onSelect={onSelectParent} />}
      {/* No row actions while renaming: the input owns the row, as in the sidebar. */}
      {rename.isEditing ? null : <HiveRowMenu view={view} menu={menu} onRename={rename.start} />}
    </div>
  )
}

/**
 * "Spawned by ‹parent›" under a row below the first level (#377). It is a link to the parent's
 * row while that row is loaded, and plain text until its page arrives. It sits beside the row's
 * button rather than inside it, because a button cannot hold another control.
 */
function HiveSpawnedBy({
  parent,
  onSelect,
}: {
  readonly parent: HiveRowParent | null
  readonly onSelect: ((parentId: string) => void) | undefined
}) {
  if (parent === null || parent.isQueen) return null
  return (
    <div className="-mt-1.5 pr-9 pb-1 pl-10 text-xs text-text-tertiary">
      {parent.loaded && onSelect ? (
        <Button
          variant="unstyled"
          className="max-w-full truncate text-left text-text-tertiary underline-offset-2 hover:text-text-secondary hover:underline"
          onClick={() => onSelect(parent.id)}
        >
          Spawned by {parent.title}
        </Button>
      ) : (
        <span className="block truncate">Spawned by {parent.title} (not loaded)</span>
      )}
    </div>
  )
}
