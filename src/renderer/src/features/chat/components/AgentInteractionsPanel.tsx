import type {
  AgentLoopInteraction,
  AgentLoopInteractionResponse,
} from '@shared/types/agent-loop-interaction'
import type { ExtensionContributionRegistryView } from '@shared/types/extensions'
import { useState } from 'react'
import { AgentInteractionCard } from './AgentInteractionCard'

const EMPTY_EXTENSION_PROJECT_PATHS: readonly string[] = []

type RespondToInteraction = (
  interaction: AgentLoopInteraction,
  response: AgentLoopInteractionResponse,
) => Promise<void>

interface AgentInteractionsPanelProps {
  readonly interactions: readonly AgentLoopInteraction[]
  readonly extensionRegistry?: ExtensionContributionRegistryView | null
  readonly extensionProjectPaths?: readonly string[]
  onRespond: RespondToInteraction
}

function isPending(busyInteractionId: string | null, interaction: AgentLoopInteraction) {
  return busyInteractionId === interaction.interactionId
}

export function AgentInteractionsPanel({
  interactions,
  extensionRegistry = null,
  extensionProjectPaths = EMPTY_EXTENSION_PROJECT_PATHS,
  onRespond,
}: AgentInteractionsPanelProps) {
  const [busyInteractionId, setBusyInteractionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (interactions.length === 0) {
    return null
  }

  function submit(interaction: AgentLoopInteraction, response: AgentLoopInteractionResponse) {
    setError(null)
    setBusyInteractionId(interaction.interactionId)
    onRespond(interaction, response)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        setBusyInteractionId(null)
      })
  }

  return (
    <div className="border-t border-border bg-bg-secondary/40 px-6 py-3">
      <div className="mx-auto grid max-w-[720px] gap-3">
        {interactions.map((interaction) => (
          <AgentInteractionCard
            busy={isPending(busyInteractionId, interaction)}
            extensionProjectPaths={extensionProjectPaths}
            extensionRegistry={extensionRegistry}
            interaction={interaction}
            key={interaction.interactionId}
            submit={submit}
          />
        ))}
        {error ? <p className="text-[12px] text-error">{error}</p> : null}
      </div>
    </div>
  )
}
