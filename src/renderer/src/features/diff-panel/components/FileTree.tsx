import {
  hotkeysCoreFeature,
  type ItemInstance,
  selectionFeature,
  syncDataLoaderFeature,
} from '@headless-tree/core'
import { AssistiveTreeDescription, useTree } from '@headless-tree/react'
import type { GitFileDiff } from '@shared/types/git'
import { ChevronDown, ChevronRight } from 'lucide-react'
import {
  type MouseEvent,
  type UIEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  buildNavigatorTree,
  NAVIGATOR_ROOT_ID,
  type NavigatorNode,
} from '@/features/diff-panel/lib/navigator-tree'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { FileChangeBadges } from './FileChangeBadges'

interface FileTreeProps {
  readonly files: readonly GitFileDiff[]
  readonly onFileClick: (path: string) => void
}

const INDENT_PX = 10
const ROW_PADDING_PX = 8
const ROW_HEIGHT_REM = 1.375
const DEFAULT_ROOT_FONT_SIZE_PX = 16
const DEFAULT_ROW_HEIGHT_PX = ROW_HEIGHT_REM * DEFAULT_ROOT_FONT_SIZE_PX
const VIRTUAL_OVERSCAN_ROWS = 6
const FALLBACK_VIEWPORT_HEIGHT_PX = DEFAULT_ROW_HEIGHT_PX * 12

type ButtonClickHandler = (event: MouseEvent<HTMLButtonElement>) => void
type ContainerRefCallback = (element: HTMLDivElement | null) => void

/**
 * getProps() from the tree library is loosely typed, so narrow its click handler
 * at the boundary instead of asserting. Without forwarding it, the library's focus
 * and selection handling would be lost.
 */
function isClickHandler(value: unknown): value is ButtonClickHandler {
  return typeof value === 'function'
}

function isContainerRefCallback(value: unknown): value is ContainerRefCallback {
  return typeof value === 'function'
}

function currentRowHeight() {
  const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
  return Number.isFinite(rootFontSize) && rootFontSize > 0
    ? rootFontSize * ROW_HEIGHT_REM
    : DEFAULT_ROW_HEIGHT_PX
}

const ROOT_NODE: NavigatorNode = { path: NAVIGATOR_ROOT_ID, name: 'Changed files', isFile: false }

/**
 * Changed-file navigator.
 *
 * Built on @headless-tree so keyboard navigation, focus management, and the
 * ARIA tree semantics come from a maintained implementation rather than being
 * hand-rolled, while every row is still rendered with our own tokens (ADR 0016).
 *
 * Expansion is DERIVED, not stored: every folder is expanded unless the user
 * explicitly collapsed it. `initialState.expandedItems` is applied only on mount,
 * so storing it meant a navigator that mounted while the diff was still empty --
 * routine in Branch and Turn scope, where the working tree is often clean -- kept
 * an empty expanded set forever and rendered zero rows while the diff body showed
 * files. Deriving it makes the rendered tree a pure function of the current diff.
 */
function useNavigatorTree(
  files: readonly GitFileDiff[],
  scrollToItem: (item: ItemInstance<NavigatorNode>) => void,
) {
  const { nodes, childrenByPath } = useMemo(() => buildNavigatorTree(files), [files])
  const folderIds = useMemo(() => [...childrenByPath.keys()], [childrenByPath])
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const expandedItems = useMemo(
    () => folderIds.filter((id) => !collapsed.has(id)),
    [folderIds, collapsed],
  )

  return useTree<NavigatorNode>({
    rootItemId: NAVIGATOR_ROOT_ID,
    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) => !item.getItemData().isFile,
    dataLoader: {
      getItem: (itemId) => nodes.get(itemId) ?? ROOT_NODE,
      getChildren: (itemId) => [...(childrenByPath.get(itemId) ?? [])],
    },
    indent: INDENT_PX,
    scrollToItem,
    // Only expandedItems is controlled; selection and focus stay internal to the
    // library so its own keyboard handling keeps working.
    state: { expandedItems },
    setState: (updater) => {
      const next = typeof updater === 'function' ? updater({ expandedItems }) : updater
      if (next.expandedItems === undefined) return
      const nextExpanded = new Set(next.expandedItems)
      setCollapsed((prev) => {
        const computed = folderIds.filter((id) => !nextExpanded.has(id))
        // Preserve identity when nothing actually changed. Without this the
        // controlled expandedItems array is new on every sync, the library calls
        // setState again, and React aborts with "Too many re-renders".
        if (computed.length === prev.size && computed.every((id) => prev.has(id))) return prev
        return new Set(computed)
      })
    },
    features: [syncDataLoaderFeature, selectionFeature, hotkeysCoreFeature],
  })
}

function useVirtualizedNavigator(files: readonly GitFileDiff[]) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(FALLBACK_VIEWPORT_HEIGHT_PX)
  const [rowHeight, setRowHeight] = useState(currentRowHeight)
  const scrollToItem = useCallback((item: ItemInstance<NavigatorNode>) => {
    const viewport = viewportRef.current
    if (viewport === null) return
    const index = item.getItemMeta().index
    const measuredRowHeight = currentRowHeight()
    const rowTop = index * measuredRowHeight
    const rowBottom = rowTop + measuredRowHeight
    const visibleBottom = viewport.scrollTop + viewport.clientHeight
    let nextScrollTop = viewport.scrollTop
    if (rowTop < viewport.scrollTop) nextScrollTop = rowTop
    if (rowTop >= viewport.scrollTop && rowBottom > visibleBottom) {
      nextScrollTop = rowBottom - viewport.clientHeight
    }
    if (nextScrollTop === viewport.scrollTop) return
    viewport.scrollTo({ top: nextScrollTop })
    setScrollTop(nextScrollTop)
  }, [])
  const tree = useNavigatorTree(files, scrollToItem)
  const items = tree.getItems().filter((item) => item.getItemData().path !== NAVIGATOR_ROOT_ID)

  useEffect(() => {
    const viewport = viewportRef.current
    if (viewport === null || typeof ResizeObserver === 'undefined') return
    const updateHeight = () => {
      if (viewport.clientHeight > 0) setViewportHeight(viewport.clientHeight)
      setRowHeight(currentRowHeight())
    }
    updateHeight()
    const observer = new ResizeObserver(updateHeight)
    observer.observe(viewport)
    const rootObserver = new MutationObserver(updateHeight)
    rootObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style'],
    })
    return () => {
      observer.disconnect()
      rootObserver.disconnect()
    }
  }, [])

  const firstVisibleIndex = Math.floor(scrollTop / rowHeight)
  const startIndex = Math.max(0, firstVisibleIndex - VIRTUAL_OVERSCAN_ROWS)
  const visibleRowCount = Math.ceil(viewportHeight / rowHeight)
  const endIndex = Math.min(
    items.length,
    firstVisibleIndex + visibleRowCount + VIRTUAL_OVERSCAN_ROWS,
  )
  const visibleRows = items
    .slice(startIndex, endIndex)
    .map((item, offset) => ({ item, index: startIndex + offset }))
  const focusedIndex = items.findIndex((item) => item.isFocused())
  if (focusedIndex >= 0 && (focusedIndex < startIndex || focusedIndex >= endIndex)) {
    const focusedItem = items[focusedIndex]
    if (focusedItem !== undefined) visibleRows.push({ item: focusedItem, index: focusedIndex })
  }
  const containerProps = tree.getContainerProps()
  const treeContainerRef = isContainerRefCallback(containerProps.ref)
    ? containerProps.ref
    : undefined
  const handleContainerRef = useCallback(
    (element: HTMLDivElement | null) => {
      viewportRef.current = element
      treeContainerRef?.(element)
    },
    [treeContainerRef],
  )
  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop)
    if (event.currentTarget.clientHeight > 0) {
      setViewportHeight(event.currentTarget.clientHeight)
    }
  }, [])

  return {
    tree,
    containerProps,
    handleContainerRef,
    handleScroll,
    items,
    rowHeight,
    startIndex,
    visibleRows,
  }
}

export function FileTree({ files, onFileClick }: FileTreeProps) {
  // React Compiler must not memoize this component. @headless-tree owns a mutable
  // tree instance and mutates it in place, so `tree` keeps the same identity while
  // its visible-item list changes. The compiler therefore cached the mapped rows
  // and the navigator rendered permanently empty in the packaged/dev app while
  // every test passed -- vitest does not run the compiler, so the suite is
  // structurally blind to this class of bug (see MEMORY.md).
  'use no memo'

  const { tree, containerProps, handleContainerRef, handleScroll, items, rowHeight, visibleRows } =
    useVirtualizedNavigator(files)

  return (
    <div className="flex min-h-0 flex-1 flex-col py-2">
      <div
        {...containerProps}
        ref={handleContainerRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-auto outline-none"
      >
        <AssistiveTreeDescription tree={tree} />
        <div
          className="relative w-full"
          data-navigator-virtual-space="true"
          style={{ height: `${String(items.length * rowHeight)}px` }}
        >
          {visibleRows.map(({ item, index }) => {
            const data = item.getItemData()
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
                  position: 'absolute',
                  insetInline: 0,
                  top: `${String(index * rowHeight)}px`,
                  paddingLeft: `${String(item.getItemMeta().level * INDENT_PX + ROW_PADDING_PX)}px`,
                  // Chromium can skip layout and paint for navigator rows outside the scrollport.
                  // Keep the intrinsic height equal to h-5.5 so scrolling does not jump as rows enter view.
                  contentVisibility: 'auto',
                  containIntrinsicSize: `auto ${String(ROW_HEIGHT_REM)}rem`,
                }}
                className={cn(
                  'flex h-5.5 w-full items-center gap-1.5 pr-1.5 text-left outline-none',
                  item.isFocused() && 'bg-bg-hover',
                  item.isSelected() && 'bg-diff-highlight-bg',
                  'hover:bg-bg-hover',
                )}
              >
                {isFolder ? (
                  <ChevIcon className="size-3 shrink-0 text-text-tertiary" />
                ) : (
                  <span className="size-3 shrink-0" />
                )}
                <span
                  className={cn(
                    'truncate text-xs',
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
    </div>
  )
}
