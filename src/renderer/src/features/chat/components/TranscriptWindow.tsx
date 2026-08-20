import { matchBy } from '@diegogbrisa/ts-match'
import { useState } from 'react'
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
    .with(
      'agent-loop-custom-message',
      (value) => `custom:${value.event.timestamp}:${value.event.name}`,
    )
    .with('agent-loop-interaction-event', (value) =>
      value.event.type === 'agent_interaction_request'
        ? `interaction-request:${value.event.interaction.interactionId}`
        : `interaction-resolved:${value.event.interactionId}`,
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
  const [limit, setLimit] = useState(INITIAL_ROW_WINDOW)
  const hiddenCount = Math.max(0, rows.length - limit)
  const visibleRows = hiddenCount === 0 ? rows : rows.slice(hiddenCount)

  return (
    <>
      {hiddenCount > 0 ? (
        <div className="mx-auto w-full max-w-[720px] px-12 pt-5 pb-6">
          <Button
            variant="secondary"
            type="button"
            className="w-full justify-center text-[12px]"
            onClick={() => setLimit((current) => current + LOAD_EARLIER_ROW_COUNT)}
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
            className="mx-auto w-full max-w-[720px] px-12 pb-6"
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
