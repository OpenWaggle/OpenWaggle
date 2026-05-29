import { ScrollToBottomButton } from '@/features/chat/components'
import type { SessionTreePanelContent as SessionTreePanelContentModel } from '../model'
import { SessionTreeRows } from './SessionTreeRows'

interface SessionTreePanelContentProps {
  readonly content: SessionTreePanelContentModel
}

function EmptySessionTreeMessage({ searchActive }: { readonly searchActive: boolean }) {
  return (
    <div className="px-2 py-6 text-center text-[12px] text-text-tertiary">
      {searchActive ? 'No nodes match this search.' : 'No nodes match this filter.'}
    </div>
  )
}

export function SessionTreePanelContent({ content }: SessionTreePanelContentProps) {
  const {
    onScrollToTreeBottom,
    onTreeScroll,
    rowActions,
    rowRefs: rowElements,
    scrollContainerRef: scrollContainer,
    searchActive,
    showTreeScrollToBottom,
    tree,
    treeRowsRef: treeRows,
    view,
  } = content

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scrollContainer} className="h-full overflow-y-auto p-2" onScroll={onTreeScroll}>
        {!tree ? (
          <div className="px-2 py-6 text-center text-[12px] text-text-tertiary">
            No session tree yet.
          </div>
        ) : view?.visibleRows.length === 0 ? (
          <EmptySessionTreeMessage searchActive={searchActive} />
        ) : view ? (
          <div ref={treeRows}>
            <SessionTreeRows actions={rowActions} refs={{ rowRefs: rowElements }} view={view} />
          </div>
        ) : null}
      </div>
      <ScrollToBottomButton visible={showTreeScrollToBottom} onClick={onScrollToTreeBottom} />
    </div>
  )
}
