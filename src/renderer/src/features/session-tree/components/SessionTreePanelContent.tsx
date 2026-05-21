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
  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={content.scrollContainerRef}
        className="h-full overflow-y-auto p-2"
        onScroll={content.onTreeScroll}
      >
        {!content.tree ? (
          <div className="px-2 py-6 text-center text-[12px] text-text-tertiary">
            No session tree yet.
          </div>
        ) : content.view?.visibleRows.length === 0 ? (
          <EmptySessionTreeMessage searchActive={content.searchActive} />
        ) : content.view ? (
          <div ref={content.treeRowsRef}>
            <SessionTreeRows
              actions={content.rowActions}
              refs={{ rowRefs: content.rowRefs }}
              view={content.view}
            />
          </div>
        ) : null}
      </div>
      <ScrollToBottomButton
        visible={content.showTreeScrollToBottom}
        onClick={content.onScrollToTreeBottom}
      />
    </div>
  )
}
