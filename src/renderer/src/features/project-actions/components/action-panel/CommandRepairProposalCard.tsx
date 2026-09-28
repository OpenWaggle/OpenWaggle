import { safeDecodeUnknown } from '@shared/schema'
import { commandRepairProposalSchema } from '@shared/schemas/action-definitions'
import { Wrench } from 'lucide-react'
import { useChat } from '@/features/chat/hooks'
import { Button } from '@/shared/ui/Button'
import { useActionPanelStore } from '../../state/action-panel-store'

/** A tool result's structured details, whether live or projected from history. */
function proposalFrom(content: unknown) {
  const candidates = [
    content,
    content !== null && typeof content === 'object' ? Reflect.get(content, 'details') : undefined,
  ]
  for (const candidate of candidates) {
    const decoded = safeDecodeUnknown(commandRepairProposalSchema, candidate)
    if (decoded.success) return decoded.data
  }
  return null
}

/**
 * An agent's Command repair proposal in the transcript. It is only a suggestion: Review and save
 * opens the action panel with it as the draft; nothing changes until the user saves (ADR 0038).
 */
export function CommandRepairProposalCard({ content }: { readonly content: unknown }) {
  const { activeSession } = useChat()
  const proposal = proposalFrom(content)
  if (!proposal || !activeSession?.projectPath) return null
  const { projectPath } = activeSession
  return (
    <section
      aria-label={`Proposed fix for ${proposal.actionName}`}
      className="grid gap-2.5 rounded-xl border border-border-light bg-bg-secondary px-4 py-3.5"
    >
      <p className="flex items-center gap-2 text-sm font-medium text-text-primary">
        <Wrench aria-hidden className="size-4 text-text-tertiary" />
        Proposed fix for {proposal.actionName}
      </p>
      <p className="text-sm leading-6 text-text-secondary">{proposal.reason}</p>
      <p className="break-words text-sm leading-6 text-text-tertiary">
        <code className="font-mono">{proposal.current.command}</code> →{' '}
        <code className="font-mono text-text-primary">{proposal.proposed.command}</code>
      </p>
      <Button
        variant="secondary"
        className="justify-self-start"
        onClick={() =>
          useActionPanelStore.getState().openPanel({
            kind: 'action',
            scope: { projectPath, sessionId: activeSession.id },
            actionId: proposal.actionId,
            origin: 'session',
            proposal,
          })
        }
      >
        Review and save
      </Button>
    </section>
  )
}
