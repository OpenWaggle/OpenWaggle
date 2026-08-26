import { Bug } from 'lucide-react'
import { Button } from '@/shared/ui/Button'

export function FeedbackButton({ onOpen }: { readonly onOpen: () => void }) {
  return (
    <Button
      variant="unstyled"
      type="button"
      aria-label="Report a bug"
      // Must not forward the click event: onOpen is openFeedbackModal(errorContext?),
      // so passing the MouseEvent through made errorContext a truthy non-error
      // object and crashed the modal on `errorContext.userMessage.trim()`.
      onClick={() => onOpen()}
      className="no-drag flex items-center gap-1 h-7 px-2 rounded-md border border-button-border transition-colors hover:bg-bg-hover"
      title="Report a bug"
    >
      <Bug className="size-3.5 text-text-secondary" />
    </Button>
  )
}
