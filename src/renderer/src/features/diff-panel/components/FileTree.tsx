import { hotkeysCoreFeature, selectionFeature, syncDataLoaderFeature } from '@headless-tree/core'
import { AssistiveTreeDescription, useTree } from '@headless-tree/react'
import type { GitFileDiff } from '@shared/types/git'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { type MouseEvent, useMemo } from 'react'
import { useNavigatorResize } from '@/features/diff-panel/hooks/useNavigatorResize'
import {
  buildNavigatorTree,
  type FileChangeStats,
  type FileChangeStatus,
  NAVIGATOR_ROOT_ID,
  type NavigatorNode,
} from '@/features/diff-panel/lib/navigator-tree'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'

interface FileTreeProps {
  readonly files: readonly GitFileDiff[]
  readonly onFileClick: (path: string) => void
}

const INDENT_PX = 10
const NUDGE_STEP = 16
const ROW_PADDING_PX = 8

const STATUS_GLYPH: Record<FileChangeStatus, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
}

const STATUS_CLASS: Record<FileChangeStatus, string> = {
  added: 'text-diff-add-mark',
  modified: 'text-accent',
  deleted: 'text-diff-remove-text',
}

type ButtonClickHandler = (event: MouseEvent<HTMLButtonElement>) => void

/**
 * getProps() from the tree library is loosely typed, so narrow its click handler
 * at the boundary instead of asserting. Without forwarding it, the library's focus
 * and selection handling would be lost.
 */
function isClickHandler(value: unknown): value is ButtonClickHandler {
  return typeof value === 'function'
}

const ROOT_NODE: NavigatorNode = { path: NAVIGATOR_ROOT_ID, name: 'Changed files', isFile: false }

function FileChangeBadges({ stats }: { readonly stats: FileChangeStats }) {
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1 pl-1">
      {stats.additions > 0 ? (
        <span className="text-[10px] text-diff-add-mark">+{String(stats.additions)}</span>
      ) : null}
      {stats.deletions > 0 ? (
        <span className="text-[10px] text-diff-remove-text">-{String(stats.deletions)}</span>
      ) : null}
      <span
        role="img"
        aria-label={stats.status}
        title={stats.status}
        className={cn('w-2 text-center text-[10px] font-semibold', STATUS_CLASS[stats.status])}
      >
        {STATUS_GLYPH[stats.status]}
      </span>
    </span>
  )
}

/**
 * Changed-file navigator.
 *
 * Built on @headless-tree so keyboard navigation, focus management, and the
 * ARIA tree semantics come from a maintained implementation rather than being
 * hand-rolled, while every row is still rendered with our own tokens (ADR 0014).
 */
export function FileTree({ files, onFileClick }: FileTreeProps) {
  const { nodes, childrenByPath } = useMemo(() => buildNavigatorTree(files), [files])
  const { width, isResizing, startResizing, nudge } = useNavigatorResize()

  const tree = useTree<NavigatorNode>({
    rootItemId: NAVIGATOR_ROOT_ID,
    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) => !item.getItemData().isFile,
    dataLoader: {
      getItem: (itemId) => nodes.get(itemId) ?? ROOT_NODE,
      getChildren: (itemId) => [...(childrenByPath.get(itemId) ?? [])],
    },
    indent: INDENT_PX,
    initialState: { expandedItems: [...childrenByPath.keys()] },
    features: [syncDataLoaderFeature, selectionFeature, hotkeysCoreFeature],
  })

  return (
    <div
      className="relative flex h-full shrink-0 flex-col border-l border-border bg-diff-bg py-2"
      style={{ width: `${String(width)}px` }}
    >
      {/*
        Resize rail, docked on the left edge of a right-docked panel, so dragging
        left widens it. Focusable with arrow-key resizing: the app's existing
        right-sidebar rail is pointer-only (tabIndex -1), which is not reachable
        for keyboard users.
      */}
      <Button
        variant="unstyled"
        type="button"
        aria-label={`Resize changed file list, currently ${String(width)} pixels`}
        title="Drag or use arrow keys to resize"
        onPointerDown={(event) => {
          event.preventDefault()
          startResizing()
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') {
            event.preventDefault()
            nudge(NUDGE_STEP)
            return
          }
          if (event.key === 'ArrowRight') {
            event.preventDefault()
            nudge(-NUDGE_STEP)
          }
        }}
        className={cn(
          'absolute inset-y-0 left-0 z-10 w-1 cursor-col-resize border-0 bg-transparent p-0 transition-colors',
          isResizing ? 'bg-accent/60' : 'hover:bg-accent/40 focus-visible:bg-accent/60',
        )}
      />

      <div {...tree.getContainerProps()} className="flex-1 overflow-auto outline-none">
        <AssistiveTreeDescription tree={tree} />
        {tree.getItems().map((item) => {
          const data = item.getItemData()
          if (data.path === NAVIGATOR_ROOT_ID) return null
          const isFolder = !data.isFile
          const ChevIcon = item.isExpanded() ? ChevronDown : ChevronRight
          const itemProps = item.getProps()
          const libraryOnClick = isClickHandler(itemProps.onClick) ? itemProps.onClick : undefined

          return (
            <Button
              variant="unstyled"
              type="button"
              {...itemProps}
              key={item.getId()}
              onClick={(event) => {
                // Folders: we own expand/collapse, so the library's handler is not
                // invoked for them -- calling both toggled twice and cancelled out.
                if (isFolder) {
                  if (item.isExpanded()) item.collapse()
                  else item.expand()
                  return
                }
                libraryOnClick?.(event)
                onFileClick(data.path)
              }}
              style={{
                paddingLeft: `${String(item.getItemMeta().level * INDENT_PX + ROW_PADDING_PX)}px`,
              }}
              className={cn(
                'flex h-[22px] w-full items-center gap-1.5 pr-1.5 text-left outline-none',
                item.isFocused() && 'bg-bg-hover',
                item.isSelected() && 'bg-diff-highlight-bg',
                'hover:bg-bg-hover',
              )}
            >
              {isFolder ? (
                <ChevIcon className="size-[11px] shrink-0 text-text-tertiary" />
              ) : (
                <span className="size-[11px] shrink-0" />
              )}
              <span
                className={cn(
                  'truncate text-[12px]',
                  data.isFile ? 'text-text-primary' : 'text-text-secondary',
                )}
              >
                {data.name}
              </span>
              {data.stats ? <FileChangeBadges stats={data.stats} /> : null}
            </Button>
          )
        })}
      </div>
    </div>
  )
}
