import type {
  AgentLoopCustomInteraction,
  AgentLoopInteraction,
  AgentLoopInteractionResponse,
} from '@shared/types/agent-loop-interaction'
import type { ExtensionContributionRegistryView } from '@shared/types/extensions'
import { useState } from 'react'
import { AgentInteractionCard } from './AgentInteractionCard'

type SubmitInteractionResponse = (
  interaction: AgentLoopInteraction,
  response: AgentLoopInteractionResponse,
) => Promise<void>

function customInteractions(
  interactions: readonly AgentLoopInteraction[],
): readonly AgentLoopCustomInteraction[] {
  return interactions.filter(
    (interaction): interaction is AgentLoopCustomInteraction => interaction.kind === 'custom',
  )
}

export function AgentCustomInteractionComposerFallback({
  interactions,
  extensionRegistry,
  extensionProjectPaths,
  onRespond,
}: {
  readonly interactions: readonly AgentLoopInteraction[]
  readonly extensionRegistry: ExtensionContributionRegistryView | null
  readonly extensionProjectPaths: readonly string[]
  readonly onRespond: SubmitInteractionResponse
}) {
  const custom = customInteractions(interactions)
  const [busyInteractionId, setBusyInteractionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (custom.length === 0) {
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
    <div className="mb-2 grid gap-2">
      {custom.map((interaction) => (
        <AgentInteractionCard
          key={interaction.interactionId}
          busy={busyInteractionId === interaction.interactionId}
          extensionProjectPaths={extensionProjectPaths}
          extensionRegistry={extensionRegistry}
          interaction={interaction}
          submit={submit}
        />
      ))}
      {error ? <p className="text-[12px] leading-5 text-error">{error}</p> : null}
    </div>
  )
}
