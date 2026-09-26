import { Fragment } from 'react'
import type { ExitingRows } from '../hooks/useTurnSettlePresentation'
import { CHAT_CONTENT_FRAME_CLASS } from '../lib/chat-content-layout'
import { chatRowKeys } from '../lib/transcript-row-keys'
import { TRANSCRIPT_ROW_KEY_ATTRIBUTE } from '../lib/transcript-viewport-geometry'
import type { ChatRow } from '../lib/types-chat-row'
import type { ChatRowRenderContext } from './ChatRowRenderContext'
import { ChatRowRenderer } from './ChatRowRenderer'
import { CollapsingRows } from './CollapsingRows'

const PADDING_TOP = 20

function RowFrame({
  row,
  rowKey,
  context,
  padTop,
}: {
  readonly row: ChatRow
  readonly rowKey: string | null
  readonly context: ChatRowRenderContext
  readonly padTop: boolean
}) {
  const isUserMessage = row.type === 'message' && row.message.role === 'user'
  return (
    <div
      className={`${CHAT_CONTENT_FRAME_CLASS} pb-6`}
      data-chat-content-frame="transcript-row"
      {...(rowKey === null ? {} : { [TRANSCRIPT_ROW_KEY_ATTRIBUTE]: rowKey })}
      {...(isUserMessage ? { 'data-user-message-id': row.message.id } : {})}
      style={padTop ? { paddingTop: PADDING_TOP } : undefined}
    >
      <ChatRowRenderer row={row} context={context} />
    </div>
  )
}

function ExitingRowGroup({
  exiting,
  context,
  onExited,
}: {
  readonly exiting: ExitingRows
  readonly context: ChatRowRenderContext
  readonly onExited: () => void
}) {
  const keys = chatRowKeys(exiting.rows)
  return (
    <CollapsingRows key={exiting.id} onDone={onExited}>
      {exiting.rows.map((row, index) => (
        <RowFrame key={keys[index]} row={row} rowKey={null} context={context} padTop={false} />
      ))}
    </CollapsingRows>
  )
}

/** The mounted rows, with a settling turn's folded work collapsing in place (ADR 0036). */
export function TranscriptRows({
  rows,
  keys,
  context,
  exiting,
  onExited,
}: {
  readonly rows: readonly ChatRow[]
  readonly keys: readonly string[]
  readonly context: ChatRowRenderContext
  readonly exiting: ExitingRows | null
  readonly onExited: () => void
}) {
  const exitingGroup = exiting ? (
    <ExitingRowGroup exiting={exiting} context={context} onExited={onExited} />
  ) : null
  const exitingPlaced =
    exiting !== null && exiting.beforeKey !== null && keys.includes(exiting.beforeKey)

  return (
    <>
      {rows.map((row, index) => {
        // Keys are derived from the same rows, one per row, so every row has one.
        const rowKey = keys[index]
        if (rowKey === undefined) return null
        return (
          <Fragment key={rowKey}>
            {exitingPlaced && exiting?.beforeKey === rowKey ? exitingGroup : null}
            <RowFrame row={row} rowKey={rowKey} context={context} padTop={false} />
          </Fragment>
        )
      })}
      {exiting !== null && !exitingPlaced ? exitingGroup : null}
    </>
  )
}
