import type {
  AgentLoopInteraction,
  AgentLoopInteractionResponse,
} from '@shared/types/agent-loop-interaction'
import { useState } from 'react'
import {
  isAuthorizationRequest,
  isPromptInteraction,
  queuedRequestCount,
  ribbonEyebrow,
} from '../lib/agent-authorization-ribbon-model'
import { agentLoopInteractionMessage } from '../lib/agent-loop-interaction-view'
import { AgentAuthorizationRibbon } from './AgentAuthorizationRibbon'
import { AgentInteractionControls } from './AgentInteractionControls'

type SubmitInteractionResponse = (
  interaction: AgentLoopInteraction,
  response: AgentLoopInteractionResponse,
) => Promise<void>

/**
 * Tracks the in-flight response for one request.
 *
 * `busy` stays latched after a success rather than clearing, because the interaction is about to
 * disappear from the pending list and re-enabling the buttons in that window invited a second
 * submission of a decision that had already been made.
 */
function useResponseSubmission(
  interaction: AgentLoopInteraction,
  onRespond: SubmitInteractionResponse,
) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function submit(response: AgentLoopInteractionResponse) {
    setError(null)
    setBusy(true)
    onRespond(interaction, response).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause))
      setBusy(false)
    })
  }

  return { busy, error, submit }
}

/** A question addressed to the user: select, input, editor, or a non-authorization confirm. */
function AgentQuestionRibbon({
  interaction,
  queuedCount,
  onRespond,
}: {
  readonly interaction: AgentLoopInteraction
  readonly queuedCount: number
  readonly onRespond: SubmitInteractionResponse
}) {
  const { busy, error, submit } = useResponseSubmission(interaction, onRespond)
  const message = agentLoopInteractionMessage(interaction)
  const titleId = `question-${interaction.interactionId}`

  return (
    <section
      aria-labelledby={titleId}
      className="border-b border-border/60 px-4 py-2.5"
      data-question-ribbon="true"
    >
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold tracking-[0.14em] text-accent uppercase">
              {isPromptInteraction(interaction) ? ribbonEyebrow(interaction) : 'Waiting for you'}
            </span>
            {queuedCount > 0 ? (
              <span className="text-[10px] text-text-muted tabular-nums">1/{queuedCount + 1}</span>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-[12px] font-medium text-text-primary" id={titleId}>
            {'title' in interaction ? interaction.title : 'Waiting for your answer'}
          </p>
          {message ? (
            <p className="mt-0.5 truncate text-[10px] text-text-muted">{message}</p>
          ) : null}
        </div>
      </div>

      <div className="mt-2">
        <AgentInteractionControls busy={busy} interaction={interaction} submit={submit} />
      </div>

      {error ? (
        <p className="mt-2 text-[11px] leading-5 text-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}

function AgentAuthorizationRibbonContainer({
  interaction,
  projectName,
  queuedCount,
  onRespond,
}: {
  readonly interaction: Extract<AgentLoopInteraction, { readonly kind: 'confirm' }>
  readonly projectName: string | null
  readonly queuedCount: number
  readonly onRespond: SubmitInteractionResponse
}) {
  const { busy, error, submit } = useResponseSubmission(interaction, onRespond)
  if (!isAuthorizationRequest(interaction)) return null

  return (
    <AgentAuthorizationRibbon
      busy={busy}
      error={error}
      interaction={interaction}
      projectName={projectName}
      queuedCount={queuedCount}
      scopeKey={interaction.scopeKey}
      submit={submit}
    />
  )
}

/**
 * The request ribbon above the composer.
 *
 * Renders at most one request at a time, with a counter for the rest, and is deliberately additive:
 * it never alters the composer beneath it.
 */
export function AgentInteractionComposerPrompt({
  interactions,
  projectName = null,
  onRespond,
}: {
  readonly interactions: readonly AgentLoopInteraction[]
  readonly projectName?: string | null
  readonly onRespond: SubmitInteractionResponse
}) {
  const interaction = interactions.find(isPromptInteraction) ?? null
  if (!interaction) return null

  const queuedCount = queuedRequestCount(interactions)

  if (isAuthorizationRequest(interaction)) {
    return (
      <AgentAuthorizationRibbonContainer
        interaction={interaction}
        key={interaction.interactionId}
        onRespond={onRespond}
        projectName={projectName}
        queuedCount={queuedCount}
      />
    )
  }

  return (
    <AgentQuestionRibbon
      interaction={interaction}
      key={interaction.interactionId}
      onRespond={onRespond}
      queuedCount={queuedCount}
    />
  )
}
