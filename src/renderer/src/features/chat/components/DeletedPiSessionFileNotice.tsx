import { FileX } from 'lucide-react'
import { CHAT_CONTENT_FRAME_CLASS } from '../lib/chat-content-layout'
import { useChatStore } from '../state/chat-store'

/**
 * A discovered Session whose Pi file was deleted outside OpenWaggle still shows its transcript,
 * but cannot be continued: say so when it is opened, rather than only when a send fails.
 */
export function DeletedPiSessionFileNotice() {
  const notice = useChatStore((state) => state.activeSession?.piSessionFileDeleted)
  if (!notice) return null

  return (
    <div className={`${CHAT_CONTENT_FRAME_CLASS} pb-2`}>
      <output
        aria-live="polite"
        className="flex items-start gap-2 rounded-xl border border-border-light bg-bg-secondary/60 px-3 py-2 text-sm text-text-secondary"
      >
        <FileX aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-text-tertiary" />
        <span className="min-w-0 flex-1 break-words">{notice}</span>
      </output>
    </div>
  )
}
