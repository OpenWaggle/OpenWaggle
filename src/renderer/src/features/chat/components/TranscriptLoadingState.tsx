import { useEffect, useState } from 'react'
import { CHAT_CONTENT_FRAME_CLASS } from '../lib/chat-content-layout'

/** Most Session loads finish well within this; only slower ones show a skeleton. */
const SKELETON_DELAY_MS = 300
const SKELETON_ROWS = [
  { align: 'end', width: 'w-2/5' },
  { align: 'start', width: 'w-4/5' },
  { align: 'start', width: 'w-3/5' },
  { align: 'end', width: 'w-1/3' },
] as const

/**
 * The transcript area while a Session hydrates (ADR 0036).
 *
 * Quietly empty at first, never the Welcome screen: "not loaded yet" is not "empty", and the flash
 * of "Let's build" under the previous Session's title read as the app losing the conversation.
 */
export function TranscriptLoadingState() {
  const [showSkeleton, setShowSkeleton] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setShowSkeleton(true), SKELETON_DELAY_MS)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div
      className="flex flex-1 flex-col justify-end overflow-hidden pb-6"
      role="status"
      aria-label="Loading session"
      data-chat-transcript-loading
    >
      {showSkeleton ? (
        <div className="transcript-skeleton-enter flex flex-col gap-6 motion-reduce:animate-none">
          {SKELETON_ROWS.map((row, index) => (
            <div
              // Static placeholder shapes; their order never changes.
              key={`${row.align}-${String(index)}`}
              className={`${CHAT_CONTENT_FRAME_CLASS} flex ${row.align === 'end' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`h-10 ${row.width} animate-pulse rounded-xl bg-bg-secondary motion-reduce:animate-none`}
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
