import { safeDecodeUnknown } from '@shared/schema'
import { commandRepairProposalSchema } from '@shared/schemas/action-definitions'
import {
  COMMAND_REPAIR_PROPOSAL_TYPE,
  type CommandRepairProposal,
} from '@shared/types/action-definitions'
import { normalizeToolResultPayload } from '@shared/utils/tool-result-state'
import { Wrench } from 'lucide-react'
import { useChatStore } from '@/features/chat/state'
import { Button } from '@/shared/ui/Button'
import { useActionPanelStore } from '../../state/action-panel-store'

/** The Command repair proposal in a project_actions tool result, live or projected, if any. */
export function commandRepairProposalFrom(content: unknown): CommandRepairProposal | null {
  const payload = normalizeToolResultPayload(content)
  const details =
    payload !== null && typeof payload === 'object' && 'details' in payload
      ? payload.details
      : undefined
  for (const candidate of [details, payload]) {
    // Most project_actions results (list, output, runs) are not proposals; skip decoding them.
    if (
      candidate === null ||
      typeof candidate !== 'object' ||
      !('type' in candidate) ||
      candidate.type !== COMMAND_REPAIR_PROPOSAL_TYPE
    )
      continue
    const decoded = safeDecodeUnknown(commandRepairProposalSchema, candidate)
    if (decoded.success) return decoded.data
  }
  return null
}

/**
 * An agent's Command repair proposal in the transcript. It is only a suggestion: Review and save
 * opens the action panel with it as the draft; nothing changes until the user saves (ADR 0038).
 */
export function CommandRepairProposalCard({
  proposal,
}: {
  readonly proposal: CommandRepairProposal
}) {
  const session = useChatStore((state) => state.activeSession)
  if (!session?.projectPath) return null
  const { projectPath, id: sessionId } = session
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
        {proposal.current.resolved === false ? (
          <span>{proposal.current.command}</span>
        ) : (
          <code className="font-mono">{proposal.current.command}</code>
        )}{' '}
        → <code className="font-mono text-text-primary">{proposal.proposed.command}</code>
      </p>
      <Button
        variant="secondary"
        className="justify-self-start"
        onClick={() =>
          useActionPanelStore.getState().openPanel({
            kind: 'action',
            scope: { projectPath, sessionId },
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
