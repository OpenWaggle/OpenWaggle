import { X } from 'lucide-react'
import { useFeedback } from '@/features/feedback/hooks/useFeedback'
import { usePreferencesStore } from '@/features/settings/state'
import { useEscapeHotkey } from '@/shared/hooks/useEscapeHotkey'
import { Button } from '@/shared/ui/Button'
import { useUIStore } from '@/shell/ui-store'
import { FeedbackModalBody, FeedbackModalFooter } from './FeedbackModalContent'

export function FeedbackModal() {
  const closeFeedbackModal = useUIStore((s) => s.closeFeedbackModal)
  const errorContext = useUIStore((s) => s.feedbackErrorContext)

  const lastUserMessage: string | null = null
  const activeModel = usePreferencesStore((s) => s.settings.selectedModel)
  const activeProvider: string | null = null

  const fb = useFeedback(errorContext, lastUserMessage, activeModel, activeProvider)

  useEscapeHotkey(closeFeedbackModal)

  const canSubmit = fb.title.trim().length > 0 && !fb.submitting && !fb.cooldownActive
  const ghReady = fb.ghStatus?.available && fb.ghStatus.authenticated

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Report issue"
    >
      <div className="w-full max-w-[620px] rounded-xl border border-border-light bg-bg-secondary shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-text-primary">Report Issue</h2>
          <Button
            variant="unstyled"
            type="button"
            onClick={closeFeedbackModal}
            className="rounded p-1 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
            title="Close"
          >
            <X className="size-4" />
          </Button>
        </div>

        <FeedbackModalBody
          fb={fb}
          ghReady={ghReady}
          errorContext={errorContext}
          lastUserMessage={lastUserMessage}
        />
        <FeedbackModalFooter
          fb={fb}
          canSubmit={canSubmit}
          ghReady={ghReady}
          onClose={closeFeedbackModal}
        />
      </div>
    </div>
  )
}
