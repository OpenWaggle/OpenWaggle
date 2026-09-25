import { type Ref, useLayoutEffect, useRef, useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { CHAT_CONTENT_FRAME_CLASS } from '../lib/chat-content-layout'

const START_DATE_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

/**
 * The loading edge of the transcript window (ADR 0036).
 *
 * Rows load automatically as it approaches the viewport; it is also a focusable button so keyboard
 * and screen-reader users can load rows without scrolling.
 */
export function TranscriptLoadEdge({
  label,
  sentinelRef,
  onLoad,
}: {
  readonly label: string
  readonly sentinelRef: Ref<HTMLDivElement>
  readonly onLoad: () => void
}) {
  return (
    <div
      ref={sentinelRef}
      className={`${CHAT_CONTENT_FRAME_CLASS} flex justify-center py-3`}
      data-chat-content-frame="transcript-edge"
    >
      <Button
        variant="unstyled"
        type="button"
        onClick={onLoad}
        className="rounded-md px-2 py-1 text-xs text-text-tertiary hover:text-text-secondary focus-visible:text-text-secondary"
      >
        {label}
      </Button>
    </div>
  )
}

/**
 * Marks the first row of a Session, so a reader knows nothing more is above rather than wondering
 * whether loading stalled. Receives focus when the last earlier rows load from the keyboard.
 */
export function TranscriptStartMarker({
  createdAt,
  focusOnMount,
}: {
  readonly createdAt: number | null
  readonly focusOnMount: boolean
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    if (focusOnMount) ref.current?.focus({ preventScroll: true })
  }, [focusOnMount])

  return (
    <div
      ref={ref}
      tabIndex={-1}
      className={`${CHAT_CONTENT_FRAME_CLASS} flex items-center gap-3 pt-5 pb-6 text-xs text-text-tertiary outline-none`}
      data-chat-content-frame="transcript-start"
    >
      <span className="h-px flex-1 bg-border" aria-hidden="true" />
      <span>
        {createdAt === null
          ? 'Start of session'
          : `Start of session · ${START_DATE_FORMAT.format(createdAt)}`}
      </span>
      <span className="h-px flex-1 bg-border" aria-hidden="true" />
    </div>
  )
}

/** The top of the window: the earlier-rows edge until the Session's start is mounted. */
export function TranscriptTopEdge({
  hasEarlier,
  hasRows,
  rangeStart,
  createdAt,
  sentinelRef,
  onLoad,
}: {
  readonly hasEarlier: boolean
  readonly hasRows: boolean
  readonly rangeStart: number
  readonly createdAt: number | null
  readonly sentinelRef: Ref<HTMLDivElement>
  readonly onLoad: () => void
}) {
  // Pressed, not reached by scrolling: focus follows to the start marker once it arrives.
  const [pressed, setPressed] = useState(false)
  if (hasEarlier) {
    return (
      <TranscriptLoadEdge
        key={`earlier:${String(rangeStart)}`}
        label="Loading earlier messages…"
        sentinelRef={sentinelRef}
        onLoad={() => {
          setPressed(true)
          onLoad()
        }}
      />
    )
  }
  return hasRows ? <TranscriptStartMarker createdAt={createdAt} focusOnMount={pressed} /> : null
}
