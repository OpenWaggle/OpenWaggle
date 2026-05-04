import type { SessionNode, SessionTreeFilterMode } from '@shared/types/session'
import { useHotkey } from '@tanstack/react-hotkeys'
import { useNavigate } from '@tanstack/react-router'
import { ListTree, Search, X } from 'lucide-react'
import { useDeferredValue, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import {
  createBranchDraftSelectionFromNode,
  shouldPromptForBranchSummary,
} from '@/components/chat/branch-from-message'
import { ScrollToBottomButton } from '@/components/chat/ScrollToBottomButton'
import { buildComposerDraftContextKey } from '@/components/composer/composer-draft-context'
import { setEditorText } from '@/components/composer/lexical-utils'
import { useEscapeHotkey } from '@/hooks/useEscapeHotkey'
import { api } from '@/lib/ipc'
import { createRendererLogger } from '@/lib/logger'
import { isScrollContainerNearBottom, scrollElementToBottom } from '@/lib/scroll-to-bottom'
import { useBranchSummaryStore } from '@/stores/branch-summary-store'
import { useComposerStore } from '@/stores/composer-store'
import { usePreferencesStore } from '@/stores/preferences-store'
import { useSessionStore } from '@/stores/session-store'
import { useUIStore } from '@/stores/ui-store'
import { SessionTreeRows } from './SessionTreeRows'
import { filterSessionTreeNodes, searchSessionTreeNodes } from './session-tree-filter'
import {
  clampSessionTreeFocusIndex,
  findFirstVisibleChildIndex,
  findVisibleParentIndex,
  getVisibleSessionTreeRows,
  moveSessionTreeFocus,
  resolveExpandedSessionTreeNodeIds,
  resolveSessionTreeRowExpandedNodeIds,
  type SessionTreeRow,
} from './session-tree-visibility'

interface SessionTreePanelProps {
  readonly onClose: () => void
}

interface ExpandedNodeIdsOverride {
  readonly sessionId: SessionNode['sessionId']
  readonly nodeIds: readonly SessionNode['id'][]
}

interface SessionTreePanelState {
  readonly expandedNodeIdsOverride: ExpandedNodeIdsOverride | null
  readonly focusIndex: number
}

type SessionTreePanelAction =
  | {
      readonly type: 'set-expanded-node-ids-override'
      readonly value: ExpandedNodeIdsOverride
    }
  | {
      readonly type: 'set-focus-index'
      readonly value: number
    }

const INITIAL_SESSION_TREE_PANEL_STATE: SessionTreePanelState = {
  expandedNodeIdsOverride: null,
  focusIndex: 0,
}

function sessionTreePanelReducer(
  state: SessionTreePanelState,
  action: SessionTreePanelAction,
): SessionTreePanelState {
  if (action.type === 'set-expanded-node-ids-override') {
    return { ...state, expandedNodeIdsOverride: action.value }
  }

  return { ...state, focusIndex: action.value }
}

const FILTER_OPTIONS: readonly { value: SessionTreeFilterMode; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'no-tools', label: 'No tools' },
  { value: 'user-only', label: 'User only' },
  { value: 'labeled-only', label: 'Labeled' },
  { value: 'all', label: 'All' },
]

const logger = createRendererLogger('session-tree')

function isSessionTreeFilterMode(value: string): value is SessionTreeFilterMode {
  return FILTER_OPTIONS.some((option) => option.value === value)
}

function isExpandedNode(node: SessionNode, expandedNodeIds: readonly SessionNode['id'][]): boolean {
  return expandedNodeIds.some((expandedNodeId) => String(expandedNodeId) === String(node.id))
}

function shouldShowSessionTreeScrollButton(input: {
  readonly scrollContainer: HTMLElement | null
  readonly scrollToBottomInProgressRef: { current: boolean }
}): boolean {
  if (!input.scrollContainer) {
    return false
  }

  const hasScrollableContent =
    input.scrollContainer.scrollHeight > input.scrollContainer.clientHeight
  const nearBottom = isScrollContainerNearBottom(input.scrollContainer)
  if (input.scrollToBottomInProgressRef.current) {
    if (!hasScrollableContent || nearBottom) {
      input.scrollToBottomInProgressRef.current = false
    }
    return false
  }

  return hasScrollableContent && !nearBottom
}

function useSessionTreePanelController(onClose: SessionTreePanelProps['onClose']) {
  const navigate = useNavigate()
  const [filterMode, setFilterMode] = useState<SessionTreeFilterMode>('default')
  const [searchQuery, setSearchQuery] = useState('')
  const deferredSearchQuery = useDeferredValue(searchQuery)
  const [panelState, dispatchPanelState] = useReducer(
    sessionTreePanelReducer,
    INITIAL_SESSION_TREE_PANEL_STATE,
  )
  const [showTreeScrollToBottom, setShowTreeScrollToBottom] = useState(false)
  const rowRefs = useRef(new Map<string, HTMLButtonElement>())
  const treeRowsRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const treeScrollToBottomInProgressRef = useRef(false)
  const hasFocusedTreeRowRef = useRef(false)
  const activeWorkspace = useSessionStore((state) => state.activeWorkspace)
  const draftBranch = useSessionStore((state) => state.draftBranch)
  const setDraftBranch = useSessionStore((state) => state.setDraftBranch)
  const clearDraftBranchForSession = useSessionStore((state) => state.clearDraftBranchForSession)
  const refreshSessionWorkspace = useSessionStore((state) => state.refreshSessionWorkspace)
  const selectedModel = usePreferencesStore((state) => state.settings.selectedModel)
  const showToast = useUIStore((state) => state.showToast)

  const tree = activeWorkspace?.tree ?? null
  const activePathIds = new Set(
    activeWorkspace?.transcriptPath.map((entry) => String(entry.node.id)) ?? [],
  )
  const expandedNodeIdsOverrideForTree =
    tree && panelState.expandedNodeIdsOverride?.sessionId === tree.session.id
      ? panelState.expandedNodeIdsOverride.nodeIds
      : null
  const expandedNodeIds = resolveExpandedSessionTreeNodeIds({
    nodes: tree?.nodes ?? [],
    uiState: tree?.uiState ?? null,
    overrideNodeIds: expandedNodeIdsOverrideForTree,
  })
  const modeFilteredNodes = tree ? filterSessionTreeNodes(tree.nodes, filterMode) : []
  const filteredNodes = tree
    ? searchSessionTreeNodes({
        nodes: tree.nodes,
        filteredNodes: modeFilteredNodes,
        query: deferredSearchQuery,
      })
    : []
  const searchActive = deferredSearchQuery.trim().length > 0
  const rowExpandedNodeIds = resolveSessionTreeRowExpandedNodeIds({
    filteredNodes,
    expandedNodeIds,
    searchActive,
  })
  const visibleRows = getVisibleSessionTreeRows({
    nodes: tree?.nodes ?? [],
    filteredNodes,
    expandedNodeIds: rowExpandedNodeIds,
    activePathIds,
  })
  const visibleNodes = visibleRows.map((row) => row.node)
  const clampedFocusIndex = clampSessionTreeFocusIndex(panelState.focusIndex, visibleRows.length)

  useEffect(() => {
    let cancelled = false
    void api
      .getPiTreeFilterMode(tree?.session.projectPath ?? null)
      .then((mode) => {
        if (!cancelled) {
          setFilterMode(mode)
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        showToast(`Failed to load Session Tree filter: ${message}`)
      })

    return () => {
      cancelled = true
    }
  }, [showToast, tree?.session.projectPath])

  useEffect(() => {
    const node = visibleNodes[clampedFocusIndex]
    if (!node) {
      return
    }

    const activeElement = document.activeElement
    const focusIsInTreeRows = activeElement ? treeRowsRef.current?.contains(activeElement) : false
    if (hasFocusedTreeRowRef.current && !focusIsInTreeRows) {
      return
    }

    hasFocusedTreeRowRef.current = true
    rowRefs.current.get(String(node.id))?.focus()
  }, [visibleNodes, clampedFocusIndex])

  function persistFilterMode(mode: SessionTreeFilterMode): void {
    void api
      .setPiTreeFilterMode(mode, tree?.session.projectPath ?? null)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        showToast(`Failed to save Session Tree filter: ${message}`)
      })
  }

  function persistExpandedNodeIds(
    sessionId: SessionNode['sessionId'],
    nextExpandedNodeIds: readonly SessionNode['id'][],
  ): void {
    void api
      .updateSessionTreeUiState(sessionId, { expandedNodeIds: nextExpandedNodeIds })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        showToast(`Failed to save Session Tree state: ${message}`)
      })
  }

  function setComposerTextValue(text: string): void {
    const composer = useComposerStore.getState()
    composer.setInput(text)
    if (composer.lexicalEditor) {
      setEditorText(composer.lexicalEditor, text)
    }
  }

  function switchComposerToDraftBranch(input: {
    readonly sessionId: SessionNode['sessionId']
    readonly sourceNodeId: SessionNode['id']
    readonly fallbackText: string
  }): string {
    const contextKey = buildComposerDraftContextKey({
      projectPath: tree?.session.projectPath ?? null,
      sessionId: input.sessionId,
      draftSourceNodeId: input.sourceNodeId,
    })
    const appliedDraft = useComposerStore.getState().switchScopedDraftContext(contextKey, {
      input: input.fallbackText,
      attachments: [],
    })
    setComposerTextValue(appliedDraft.input)
    return appliedDraft.input
  }

  function maybeOpenBranchSummaryPrompt(input: {
    readonly sessionId: SessionNode['sessionId']
    readonly sourceNodeId: SessionNode['id']
    readonly previousComposerText: string
    readonly draftComposerText: string
  }): void {
    useBranchSummaryStore.getState().clearPrompt()

    if (!shouldPromptForBranchSummary(activeWorkspace, input.sourceNodeId)) {
      return
    }

    function openIfCurrent(): void {
      const currentState = useSessionStore.getState()
      const currentDraft = currentState.draftBranch
      const currentWorkspace = currentState.activeWorkspace
      if (
        !currentDraft ||
        currentDraft.sessionId !== input.sessionId ||
        currentDraft.sourceNodeId !== input.sourceNodeId ||
        currentWorkspace?.tree.session.id !== input.sessionId
      ) {
        return
      }
      useBranchSummaryStore.getState().openPrompt({
        sessionId: input.sessionId,
        sourceNodeId: input.sourceNodeId,
        restoreSelection: {
          branchId: activeWorkspace?.activeBranchId ?? null,
          nodeId: activeWorkspace?.activeNodeId ?? null,
        },
        previousComposerText: input.previousComposerText,
        draftComposerText: input.draftComposerText,
      })
    }

    if (typeof api.getPiBranchSummarySkipPrompt !== 'function') {
      openIfCurrent()
      return
    }

    void api
      .getPiBranchSummarySkipPrompt(tree?.session.projectPath ?? null)
      .then((skipPrompt) => {
        if (!skipPrompt) {
          openIfCurrent()
        }
      })
      .catch((skipPromptError: unknown) => {
        const message =
          skipPromptError instanceof Error ? skipPromptError.message : String(skipPromptError)
        logger.warn('Failed to load branch summary skip-prompt preference', { message })
        openIfCurrent()
      })
  }

  function selectNode(node: SessionNode): void {
    if (!tree) {
      return
    }

    const sessionId = tree.session.id
    const materializedBranch = tree.branches.find((branch) => branch.headNodeId === node.id)

    if (materializedBranch) {
      useBranchSummaryStore.getState().clearPrompt()
      clearDraftBranchForSession(sessionId)
      void navigate({
        to: '/sessions/$sessionId',
        params: { sessionId: String(sessionId) },
        search: (previous) => ({
          ...previous,
          branch: String(materializedBranch.id),
          node: String(node.id),
        }),
      })
      void api
        .navigateSessionTree(sessionId, selectedModel, node.id, { summarize: false })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          showToast(`Failed to switch session branch: ${message}`)
        })
        .finally(() => {
          void refreshSessionWorkspace(sessionId, {
            branchId: materializedBranch.id,
            nodeId: node.id,
          })
        })
      return
    }

    const previousComposerText = useComposerStore.getState().input
    const selection = createBranchDraftSelectionFromNode(node)
    const fallbackDraftText = selection.prefillText ?? ''
    setDraftBranch({ sessionId, sourceNodeId: selection.sourceNodeId })
    const draftComposerText = switchComposerToDraftBranch({
      sessionId,
      sourceNodeId: selection.sourceNodeId,
      fallbackText: fallbackDraftText,
    })
    maybeOpenBranchSummaryPrompt({
      sessionId,
      sourceNodeId: selection.sourceNodeId,
      previousComposerText,
      draftComposerText,
    })
    void navigate({
      to: '/sessions/$sessionId',
      params: { sessionId: String(sessionId) },
      search: (previous) => ({
        ...previous,
        branch: undefined,
        node: String(selection.routeNodeId),
      }),
    })
    void refreshSessionWorkspace(sessionId, { nodeId: selection.routeNodeId })
  }

  function toggleNodeExpanded(row: SessionTreeRow): void {
    if (!tree || !row.hasExpandableChildren) {
      return
    }

    const nextExpandedNodeIds = isExpandedNode(row.node, expandedNodeIds)
      ? expandedNodeIds.filter((expandedNodeId) => String(expandedNodeId) !== String(row.node.id))
      : [...expandedNodeIds, row.node.id]

    dispatchPanelState({
      type: 'set-expanded-node-ids-override',
      value: { sessionId: tree.session.id, nodeIds: nextExpandedNodeIds },
    })
    persistExpandedNodeIds(tree.session.id, nextExpandedNodeIds)
  }

  function moveFocus(direction: 'next' | 'previous'): void {
    dispatchPanelState({
      type: 'set-focus-index',
      value: moveSessionTreeFocus({
        currentIndex: panelState.focusIndex,
        visibleCount: visibleRows.length,
        direction,
      }),
    })
  }

  function selectFocusedNode(): void {
    const focusedRow = visibleRows[clampedFocusIndex]
    if (focusedRow) {
      selectNode(focusedRow.node)
    }
  }

  function syncTreeScrollButtonVisibility(): void {
    setShowTreeScrollToBottom(
      shouldShowSessionTreeScrollButton({
        scrollContainer: scrollContainerRef.current,
        scrollToBottomInProgressRef: treeScrollToBottomInProgressRef,
      }),
    )
  }

  function scrollToTreeBottom(): void {
    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) {
      return
    }
    treeScrollToBottomInProgressRef.current = true
    scrollElementToBottom(scrollContainer, 'smooth')
    setShowTreeScrollToBottom(false)
  }

  function expandFocusedNode(): void {
    const focusedRow = visibleRows[clampedFocusIndex]
    if (!focusedRow) {
      return
    }
    if (isExpandedNode(focusedRow.node, rowExpandedNodeIds)) {
      dispatchPanelState({
        type: 'set-focus-index',
        value: findFirstVisibleChildIndex(visibleRows, clampedFocusIndex),
      })
      return
    }
    if (focusedRow.hasExpandableChildren) {
      toggleNodeExpanded(focusedRow)
    }
  }

  function collapseFocusedNode(): void {
    const focusedRow = visibleRows[clampedFocusIndex]
    if (!focusedRow) {
      return
    }
    if (isExpandedNode(focusedRow.node, rowExpandedNodeIds)) {
      toggleNodeExpanded(focusedRow)
      return
    }
    dispatchPanelState({
      type: 'set-focus-index',
      value: findVisibleParentIndex(visibleRows, clampedFocusIndex),
    })
  }

  useLayoutEffect(() => {
    setShowTreeScrollToBottom(
      shouldShowSessionTreeScrollButton({
        scrollContainer: scrollContainerRef.current,
        scrollToBottomInProgressRef: treeScrollToBottomInProgressRef,
      }),
    )
  })

  useEscapeHotkey(onClose)
  useHotkey('ArrowDown', () => moveFocus('next'), {
    enabled: visibleRows.length > 0,
    preventDefault: true,
  })
  useHotkey('ArrowUp', () => moveFocus('previous'), {
    enabled: visibleRows.length > 0,
    preventDefault: true,
  })
  useHotkey('Enter', selectFocusedNode, {
    enabled: visibleRows.length > 0,
    preventDefault: true,
    conflictBehavior: 'allow',
  })
  useHotkey('ArrowRight', expandFocusedNode, {
    enabled: visibleRows.length > 0,
    preventDefault: true,
  })
  useHotkey('ArrowLeft', collapseFocusedNode, {
    enabled: visibleRows.length > 0,
    preventDefault: true,
  })

  return {
    activeBranchId: activeWorkspace?.activeBranchId ?? null,
    activePathIds,
    clampedFocusIndex,
    draftBranch,
    filterMode,
    rowExpandedNodeIds,
    rowRefs,
    scrollContainerRef,
    searchActive,
    searchQuery,
    showTreeScrollToBottom,
    tree,
    treeRowsRef,
    visibleRows,
    onClose,
    onFilterModeChange: (mode: string) => {
      if (isSessionTreeFilterMode(mode)) {
        setFilterMode(mode)
        persistFilterMode(mode)
      }
    },
    onFocusIndex: (index: number) => {
      dispatchPanelState({ type: 'set-focus-index', value: index })
    },
    onSearchQueryChange: setSearchQuery,
    onScrollToTreeBottom: scrollToTreeBottom,
    onTreeScroll: syncTreeScrollButtonVisibility,
    onSelectNode: selectNode,
    onToggleNodeExpanded: toggleNodeExpanded,
  }
}

export function SessionTreePanel({ onClose }: SessionTreePanelProps) {
  const panel = useSessionTreePanelController(onClose)

  return <SessionTreePanelLayout {...panel} />
}

function SessionTreePanelLayout({
  activeBranchId,
  activePathIds,
  clampedFocusIndex,
  draftBranch,
  filterMode,
  rowExpandedNodeIds,
  rowRefs,
  scrollContainerRef,
  searchActive,
  searchQuery,
  showTreeScrollToBottom,
  tree,
  treeRowsRef,
  visibleRows,
  onClose,
  onFilterModeChange,
  onFocusIndex,
  onSearchQueryChange,
  onScrollToTreeBottom,
  onTreeScroll,
  onSelectNode,
  onToggleNodeExpanded,
}: ReturnType<typeof useSessionTreePanelController>) {
  return (
    <section className="flex h-full min-w-0 flex-col bg-diff-bg" aria-label="Session Tree">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex min-w-0 items-center gap-2">
          <ListTree className="h-4 w-4 shrink-0 text-text-tertiary" />
          <h2 className="truncate text-[13px] font-semibold text-text-primary">Session Tree</h2>
        </div>
        <button
          type="button"
          aria-label="Close Session Tree"
          onClick={onClose}
          className="rounded p-1 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid h-12 shrink-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-4 border-b border-border px-4 py-2">
        <div className="flex h-8 items-center gap-2">
          <label htmlFor="session-tree-filter" className="text-[12px] text-text-tertiary">
            Filter
          </label>
          <select
            id="session-tree-filter"
            value={filterMode}
            onChange={(event) => {
              onFilterModeChange(event.target.value)
            }}
            className="h-8 rounded-lg border border-input-card-border bg-bg-secondary px-2.5 text-[13px] text-text-secondary outline-none transition-[border-color,box-shadow] focus:border-accent/50 focus:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-accent)_18%,transparent)]"
          >
            {FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="relative mx-auto w-full min-w-0">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
          <input
            id="session-tree-search"
            type="search"
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            placeholder="Search nodes"
            className="h-8 w-full rounded-lg border border-input-card-border bg-bg-secondary pr-3 pl-9 text-[13px] text-text-secondary placeholder:text-text-tertiary outline-none transition-[border-color,box-shadow] focus:border-accent/50 focus:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-accent)_18%,transparent)]"
            aria-label="Search Session Tree nodes"
          />
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollContainerRef}
          className="h-full overflow-y-auto px-2 py-2"
          onScroll={onTreeScroll}
        >
          {!tree ? (
            <div className="px-2 py-6 text-center text-[12px] text-text-tertiary">
              No session tree yet.
            </div>
          ) : visibleRows.length === 0 ? (
            <div className="px-2 py-6 text-center text-[12px] text-text-tertiary">
              {searchActive ? 'No nodes match this search.' : 'No nodes match this filter.'}
            </div>
          ) : (
            <div ref={treeRowsRef}>
              <SessionTreeRows
                activeBranchId={activeBranchId}
                activePathIds={activePathIds}
                clampedFocusIndex={clampedFocusIndex}
                draftBranch={draftBranch}
                rowExpandedNodeIds={rowExpandedNodeIds}
                rowRefs={rowRefs}
                tree={tree}
                visibleRows={visibleRows}
                onFocusIndex={onFocusIndex}
                onSelectNode={onSelectNode}
                onToggleNodeExpanded={onToggleNodeExpanded}
              />
            </div>
          )}
        </div>
        <ScrollToBottomButton visible={showTreeScrollToBottom} onClick={onScrollToTreeBottom} />
      </div>
    </section>
  )
}
