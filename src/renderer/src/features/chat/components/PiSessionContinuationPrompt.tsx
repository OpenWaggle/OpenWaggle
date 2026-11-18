import { useEffect, useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { Checkbox } from '@/shared/ui/Checkbox'
import { ModalDialog } from '@/shared/ui/ModalDialog'
import { usePiSessionContinuationStore } from '../state/pi-session-continuation-store'

function PiSessionContinuationDialog({ projectPath }: { readonly projectPath: string | null }) {
  const answer = usePiSessionContinuationStore((state) => state.answer)
  const [remember, setRemember] = useState(false)

  return (
    <ModalDialog labelledBy="pi-session-continuation-title" onClose={() => answer(null)}>
      <div className="space-y-4 p-5">
        <div className="space-y-1.5">
          <h3 className="text-base font-semibold" id="pi-session-continuation-title">
            Continue this session in OpenWaggle?
          </h3>
          <p className="text-xs leading-5 text-text-tertiary">
            This session was last used in pi. OpenWaggle and pi do not lock the session file, so use
            one of them at a time. Keep running it in pi to open the terminal with the command typed
            in; your message stays in the composer.
          </p>
        </div>
        {projectPath ? (
          <Checkbox
            checked={remember}
            label="Remember for this project (only for you; change it in Settings > General)"
            labelClassName="text-xs"
            onChange={(event) => setRemember(event.currentTarget.checked)}
          />
        ) : null}
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={() => answer({ choice: 'pi', remember })}>
            Keep running in pi
          </Button>
          <Button
            autoFocus
            size="sm"
            variant="primary"
            onClick={() => answer({ choice: 'openwaggle', remember })}
          >
            Continue in OpenWaggle
          </Button>
        </div>
      </div>
    </ModalDialog>
  )
}

/**
 * The Pi continuation prompt (ADR 0051) for the send that asked. Leaving the chat view dismisses
 * it, which puts the message back in the composer.
 */
export function PiSessionContinuationPrompt() {
  const pending = usePiSessionContinuationStore((state) => state.pending)
  const answer = usePiSessionContinuationStore((state) => state.answer)
  useEffect(() => () => answer(null), [answer])
  if (!pending) return null
  return <PiSessionContinuationDialog key={pending.sessionId} projectPath={pending.projectPath} />
}
