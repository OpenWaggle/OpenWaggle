import { ArrowUp, Check, Square } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'

/**
 * How a Run the agent ended is finishing. `settling`: the Host saves it and nothing is left to stop.
 * `stoppable`: Pi still runs post-loop work, such as an extension's `agent_before_settle` check,
 * and Stop aborts it.
 */
export type ComposerRunFinishing = 'settling' | 'stoppable'

interface ComposerSendControlsProps {
  readonly isLoading: boolean
  /** The agent has ended the Run; undefined while it is not finishing. */
  readonly finishing?: ComposerRunFinishing
  readonly canSend: boolean
  readonly sendTitle?: string
  /** Save a queued-message edit rather than send a new message. */
  readonly savesEdit?: boolean
  readonly onSend: () => void
  readonly onCancel: () => void
}

export function ComposerSendControls({
  isLoading,
  finishing,
  canSend,
  sendTitle,
  savesEdit = false,
  onSend,
  onCancel,
}: ComposerSendControlsProps) {
  return (
    <>
      {finishing ? <FinishingRunNotice finishing={finishing} /> : null}
      {isLoading && finishing !== 'settling' ? <CancelRunButton onCancel={onCancel} /> : null}
      <SendMessageButton
        isLoading={isLoading && !savesEdit}
        savesEdit={savesEdit}
        canSend={canSend}
        sendTitle={sendTitle}
        onSend={onSend}
      />
    </>
  )
}

/*
 * While a Run the agent already ended is finishing, in place of Stop or, while the agent still
 * works on, beside it. A message sent now waits in the queue and starts once the Run has settled.
 */
function FinishingRunNotice({ finishing }: { readonly finishing: ComposerRunFinishing }) {
  return (
    <span
      className="text-xs whitespace-nowrap text-text-tertiary"
      title={
        finishing === 'stoppable'
          ? 'The reply is done, but an extension is still working before the Run ends. Stop ends it; a message sent now starts right after.'
          : 'The agent is done. OpenWaggle is saving this Run; a message sent now starts right after.'
      }
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
  readonly savesEdit: boolean
  readonly onSend: () => void
}

function SendMessageButton({
  isLoading,
  canSend,
  sendTitle,
  savesEdit,
  onSend,
}: SendMessageButtonProps) {
  const Icon = savesEdit ? Check : ArrowUp
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
      <Icon className={cn('size-4', canSend ? getSendIconTone(isLoading) : 'text-text-muted')} />
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
