import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/cn'
import { useTranscriptCommitLayout } from '../hooks/useTranscriptCommitLayout'
import { useTranscriptEdgeLoading } from '../hooks/useTranscriptEdgeLoading'
import { useTranscriptViewport } from '../hooks/useTranscriptViewport'
import { useTranscriptWindowRange } from '../hooks/useTranscriptWindowRange'
import { useTurnSettlePresentation } from '../hooks/useTurnSettlePresentation'
import { chatRowKeys } from '../lib/transcript-row-keys'
import { latestTurnHasToolActivity, visibleMessageNodeIds } from '../lib/transcript-rows'
import type { ChatRow } from '../lib/types-chat-row'
import type { ChatRowRenderContext } from './ChatRowRenderContext'
import { ScrollToBottomButton } from './ScrollToBottomButton'
import { TranscriptRows } from './TranscriptRows'
import { TranscriptLoadEdge, TranscriptTopEdge } from './TranscriptWindowEdges'

export interface TranscriptViewportInput {
  readonly rows: readonly ChatRow[]
  readonly context: ChatRowRenderContext
  readonly isLoading: boolean
  readonly lastUserMessageId: string | null
  readonly userDidSend: boolean
  readonly onUserDidSendConsumed: () => void
  readonly onToggleTurnFold: (turnKey: string) => void
  readonly sessionCreatedAt: number | null
}

/**
 * The scrolling transcript for one Session branch (ADR 0036).
 *
 * Keyed by Session and branch by its parent, so a switch builds a fresh window around that
 * branch's own saved reading position instead of slicing the previous branch's rows.
 */
export function TranscriptViewport({
  positionKey,
  input,
  trailing,
  renderVisibleMessageRows,
}: {
  readonly positionKey: string
  readonly input: TranscriptViewportInput
  readonly trailing: ReactNode
  readonly renderVisibleMessageRows?: (nodeIds: readonly string[], rows: ReactNode) => ReactNode
}) {
  const { rows, isLoading, lastUserMessageId, userDidSend, onUserDidSendConsumed } = input
  const keys = chatRowKeys(rows)
  const { session, showScrollToBottom, showScrollbar } = useTranscriptViewport(
    positionKey,
    keys.length > 0,
  )
  const transcriptWindow = useTranscriptWindowRange({
    rows,
    keys,
    anchorKey: session.savedPosition?.key ?? null,
    isFollowing: () => session.controller.isFollowing,
  })
  const { exiting, clearExiting } = useTurnSettlePresentation({
    rows,
    keys,
    isLoading,
    viewport: session,
    onToggleTurnFold: input.onToggleTurnFold,
  })
  const edges = useTranscriptEdgeLoading({
    viewport: session,
    loadEarlier: transcriptWindow.loadEarlier,
    loadLater: transcriptWindow.loadLater,
  })

  useTranscriptCommitLayout({
    session,
    keys,
    sentKey: lastUserMessageId ? `message:${lastUserMessageId}` : null,
    userDidSend,
    onUserDidSendConsumed,
    latestTurnHasToolActivity: latestTurnHasToolActivity(rows),
    hasLater: transcriptWindow.hasLater,
    showNewest: transcriptWindow.showNewest,
    trimForLiveEnd: transcriptWindow.trimForLiveEnd,
  })

  const visibleRows = rows.slice(transcriptWindow.start, transcriptWindow.end)
  const visibleKeys = keys.slice(transcriptWindow.start, transcriptWindow.end)
  const renderedRows = (
    <TranscriptRows
      rows={visibleRows}
      keys={visibleKeys}
      context={input.context}
      exiting={exiting}
      onExited={clearExiting}
    />
  )

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      <div
        ref={(element) => session.attach('scroller', element)}
        role="log"
        aria-label="Chat messages"
        aria-busy={isLoading}
        className={cn(
          'flex flex-1 flex-col overflow-y-auto chat-scroll [overflow-anchor:none]',
          showScrollbar && 'is-scrolling',
        )}
        {...session.scrollerHandlers}
      >
        <div
          ref={(element) => session.attach('content', element)}
          data-chat-transcript-container
          className="@container/transcript flex min-h-full flex-col"
        >
          <div aria-live="polite" className="sr-only">
            {transcriptWindow.announcement}
          </div>
          <TranscriptTopEdge
            hasEarlier={transcriptWindow.hasEarlier}
            hasRows={keys.length > 0}
            rangeStart={transcriptWindow.start}
            createdAt={input.sessionCreatedAt}
            sentinelRef={edges.earlierRef}
            onLoad={transcriptWindow.loadEarlier}
          />
          {renderVisibleMessageRows
            ? renderVisibleMessageRows(visibleMessageNodeIds(visibleRows), renderedRows)
            : renderedRows}
          {transcriptWindow.hasLater ? (
            <TranscriptLoadEdge
              key={`later:${String(transcriptWindow.end)}`}
              label="Loading newer messages…"
              sentinelRef={edges.laterRef}
              onLoad={transcriptWindow.loadLater}
            />
          ) : null}
          {trailing}
          <div
            ref={(element) => session.attach('endSpace', element)}
            aria-hidden="true"
            data-transcript-end-space
            className="shrink-0"
          />
        </div>
      </div>

      <ScrollToBottomButton
        visible={showScrollToBottom || transcriptWindow.hasLater}
        onClick={() => {
          if (transcriptWindow.hasLater) transcriptWindow.showNewest()
          session.scrollToBottom()
        }}
      />
    </div>
  )
}
