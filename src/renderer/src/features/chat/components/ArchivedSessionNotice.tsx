import { Archive, RotateCcw } from 'lucide-react'
import { useUnarchiveSessionMutation } from '@/queries/archived-sessions'
import { Button } from '@/shared/ui/Button'
import { CHAT_CONTENT_FRAME_CLASS } from '../lib/chat-content-layout'
import { useChatStore } from '../state/chat-store'

/**
 * An open session can be archived under the reader: from another window, the CLI, or by Hive
 * cleanup once a Worker's task is accepted. It then disappears from the sidebar while it stays on
 * screen, so say so and offer the way back instead of leaving an unlisted conversation.
 */
export function ArchivedSessionNotice() {
  const session = useChatStore((state) => state.activeSession)
  const unarchive = useUnarchiveSessionMutation()
  if (!session?.archived) return null

  return (
    <div className={`${CHAT_CONTENT_FRAME_CLASS} pb-2`}>
      <output
        aria-live="polite"
        className="flex items-center gap-2 rounded-xl border border-border-light bg-bg-secondary/60 px-3 py-2 text-sm text-text-secondary"
      >
        <Archive aria-hidden="true" className="size-4 shrink-0 text-text-tertiary" />
        <span className="min-w-0 flex-1">
          {unarchive.isError
            ? 'This session is archived, and restoring it failed.'
            : 'This session is archived. It is hidden from the sidebar until you restore it.'}
        </span>
        <Button
          variant="unstyled"
          type="button"
          disabled={unarchive.isPending}
          onClick={() => unarchive.mutate(session.id)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-50"
        >
          <RotateCcw aria-hidden="true" className="size-3.5" />
          Restore
        </Button>
      </output>
    </div>
  )
}
