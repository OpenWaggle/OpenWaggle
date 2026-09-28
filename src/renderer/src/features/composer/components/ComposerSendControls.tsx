import { ArrowUp, Square } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'

interface ComposerSendControlsProps {
  readonly isLoading: boolean
  /** The agent has ended the Run and the Host is settling it; there is nothing left to stop. */
  readonly isFinishing?: boolean
  readonly canSend: boolean
  readonly sendTitle?: string
  readonly onSend: () => void
  readonly onCancel: () => void
}

export function ComposerSendControls({
  isLoading,
  isFinishing = false,
  canSend,
  sendTitle,
  onSend,
  onCancel,
}: ComposerSendControlsProps) {
  return (
    <>
      {isFinishing ? <FinishingRunNotice /> : null}
      {isLoading && !isFinishing ? <CancelRunButton onCancel={onCancel} /> : null}
      <SendMessageButton
        isLoading={isLoading}
        canSend={canSend}
        sendTitle={sendTitle}
        onSend={onSend}
      />
    </>
  )
}

/*
 * In place of Stop while the Host settles a Run the agent already ended. A message sent now waits
 * in the queue and starts once the Run has settled.
 */
function FinishingRunNotice() {
  return (
    <span
      className="text-xs whitespace-nowrap text-text-tertiary"
      title="The agent is done. OpenWaggle is saving this Run; a message sent now starts right after."
    >
      Finishing…
    </span>
  )
}

interface CancelRunButtonProps {
  readonly onCancel: () => void
}

function CancelRunButton({ onCancel }: CancelRunButtonProps) {
  return (
    <Button
      variant="unstyled"
      type="button"
      onClick={onCancel}
      className="flex size-8 items-center justify-center rounded-full border border-error/35 bg-error/10 text-error transition-colors hover:bg-error/18"
      title="Cancel"
    >
      <Square className="size-3.5" />
    </Button>
  )
}

interface SendMessageButtonProps {
  readonly isLoading: boolean
  readonly canSend: boolean
  readonly sendTitle?: string
  readonly onSend: () => void
}

function SendMessageButton({ isLoading, canSend, sendTitle, onSend }: SendMessageButtonProps) {
  return (
    <Button
      variant="unstyled"
      type="button"
      onClick={onSend}
      disabled={!canSend}
      className={cn(
        'flex size-8 items-center justify-center rounded-full transition-colors',
        getSendButtonTone(isLoading, canSend),
      )}
      title={sendTitle ?? (isLoading ? 'Add message' : 'Send message')}
    >
      <ArrowUp className={cn('size-4', canSend ? getSendIconTone(isLoading) : 'text-text-muted')} />
    </Button>
  )
}

function getSendButtonTone(isLoading: boolean, canSend: boolean) {
  if (!canSend) return 'border border-border bg-bg-tertiary cursor-not-allowed'
  return isLoading
    ? 'border border-accent/35 bg-accent/10 text-accent hover:bg-accent/18'
    : 'bg-gradient-to-b from-accent to-accent-dim'
}

function getSendIconTone(isLoading: boolean) {
  return isLoading ? 'text-accent' : 'text-bg'
}
