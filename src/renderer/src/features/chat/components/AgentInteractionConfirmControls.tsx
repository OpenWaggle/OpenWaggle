import { Button } from '@/shared/ui/Button'
import type { AgentInteractionSubmit } from './agent-interaction-control-types'

export function AgentInteractionConfirmControls({
  busy,
  submit,
}: {
  readonly busy: boolean
  readonly submit: AgentInteractionSubmit
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        disabled={busy}
        variant="accent"
        onClick={() => submit({ kind: 'confirm', accepted: true })}
      >
        Approve
      </Button>
      <Button disabled={busy} onClick={() => submit({ kind: 'confirm', accepted: false })}>
        Decline
      </Button>
    </div>
  )
}
