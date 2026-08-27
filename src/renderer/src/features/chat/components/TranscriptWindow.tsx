import { matchBy } from '@diegogbrisa/ts-match'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/shared/ui/Button'
import type { ChatRow } from '../lib/types-chat-row'
import type { ChatRowRenderContext } from './ChatRowRenderContext'
import { ChatRowRenderer } from './ChatRowRenderer'

const PADDING_TOP = 20

/**
 * How much of a transcript is built on open, and how much each "load earlier" adds.
 *
 * A session is read from the newest end, so the window covers the rows a person lands on. Opening
 * a 400 message session used to mount every row: 7,200 DOM nodes across 50,216px of content in a
 * 580px viewport, which blocked the main thread for over a second on every switch. Both Pi's own
 * clients cap this the same way, at 10 user turns and at 100 history items respectively.
 */
const INITIAL_ROW_WINDOW = 40
const LOAD_EARLIER_ROW_COUNT = 100

function getChatRowKey(row: ChatRow) {
  return matchBy(row, 'type')
    .with('message', (value) => `message:${value.message.id}`)
    .with('waggle-turn', (value) => value.id)
    .with('interrupted-run', (value) => `interrupted-run:${value.runId}`)
    .with('worktree-launch', (value) => `worktree-launch:${value.id}`)
    .with(
      'agent-loop-custom-message',
      (value) => `custom:${value.event.timestamp}:${value.event.name}`,
    )
    .with(
      'agent-loop-interaction',
      (value) => `interaction:${value.item.request.interaction.interactionId}`,
    )
    .with('branch-summary', (value) => `branch-summary:${value.id}`)
    .with('compaction-summary', (value) => `compaction:${value.id}`)
    .with('phase-indicator', (value) => `phase:${value.label}`)
    .with('run-summary', (value) => `run-summary:${String(value.totalMs)}`)
    .with('error', (value) => `error:${value.sessionId ?? 'none'}:${value.error.message}`)
    .exhaustive()
}

/**
 * The newest slice of a transcript, with a control to reach further back.
 *
 * Remounted per session by its key, so the window resets to the newest rows on every switch
 * without an effect that would first paint the previous session's larger window.
 */
export function TranscriptWindow({
  rows,
  context,
}: {
  readonly rows: ChatRow[]
  readonly context: ChatRowRenderContext
}) {
  /*
   * The window remembers where it starts, not how big it is.
   *
   * Holding a visible limit instead made a new row push an old one out of the window: the topmost
   * mounted row unmounted on every arrival, and with [overflow-anchor:none] on the scroller a
   * reader who had scrolled up watched the view jump. It also grew a "Load earlier messages (1
   * above)" control on a session the user had read from its very first message, which is a lie
   * about the transcript. Fixing the start makes new rows purely additive.
   *
   * Initialised from the row count on mount, which is correct because the component is remounted
   * per session by its key.
   */
  const [hidden, setHidden] = useState(() => Math.max(0, rows.length - INITIAL_ROW_WINDOW))
  const [announcement, setAnnouncement] = useState('')
  const startRef = useRef<HTMLDivElement>(null)
  const pendingFocusRef = useRef(false)

  // Compaction can shrink the transcript below the recorded start, which would otherwise slice
  // everything away and leave a Load earlier control above an empty transcript.
  const hiddenCount = Math.min(hidden, Math.max(0, rows.length - 1))
  const visibleRows = hiddenCount === 0 ? rows : rows.slice(hiddenCount)

  /*
   * Keep the keyboard somewhere sensible after the control retires.
   *
   * The last press unmounts the button, which drops focus to document.body and loses the reader's
   * place entirely. Focus moves to the top of the transcript instead.
   */
  useEffect(() => {
    if (!pendingFocusRef.current || hiddenCount > 0) return
    pendingFocusRef.current = false
    startRef.current?.focus()
  }, [hiddenCount])

  function loadEarlier() {
    const revealed = Math.min(hiddenCount, LOAD_EARLIER_ROW_COUNT)
    pendingFocusRef.current = true
    setHidden((current) => Math.max(0, current - LOAD_EARLIER_ROW_COUNT))
    setAnnouncement(`${revealed} earlier messages loaded`)
  }

  return (
    <>
      {/*
       * One polite message instead of a hundred. The scroller is a role="log", whose implicit
       * aria-live is polite and whose aria-relevant defaults to additions, so inserting 100 rows in
       * one commit queued an announcement per row. The summary is what a reader actually wants.
       */}
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      {/* Focus lands here when the transcript reaches its start, so a keyboard user keeps a place. */}
      <div ref={startRef} tabIndex={-1} className="outline-none" />
      {hiddenCount > 0 ? (
        <div className="mx-auto w-full max-w-180 px-12 pt-5 pb-6">
          <Button
            variant="secondary"
            type="button"
            className="w-full justify-center text-xs"
            onClick={loadEarlier}
          >
            {`Load earlier messages (${hiddenCount} above)`}
          </Button>
        </div>
      ) : null}
      <TranscriptRows rows={visibleRows} context={context} hasEarlier={hiddenCount > 0} />
    </>
  )
}

function TranscriptRows({
  rows,
  context,
  hasEarlier,
}: {
  readonly rows: ChatRow[]
  readonly context: ChatRowRenderContext
  /** The load-earlier control already supplies the top padding when it is present. */
  readonly hasEarlier: boolean
}) {
  return (
    <>
      {rows.map((row, index) => {
        const isUserMessage = row.type === 'message' && row.message.role === 'user'
        return (
          <div
            key={getChatRowKey(row)}
            className="mx-auto w-full max-w-180 px-12 pb-6"
            {...(isUserMessage ? { 'data-user-message-id': row.message.id } : {})}
            style={index === 0 && !hasEarlier ? { paddingTop: PADDING_TOP } : undefined}
          >
            <ChatRowRenderer row={row} context={context} />
          </div>
        )
      })}
    </>
  )
}
