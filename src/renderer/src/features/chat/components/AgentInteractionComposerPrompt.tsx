import type {
  AgentLoopInteraction,
  AgentLoopInteractionResponse,
} from '@shared/types/agent-loop-interaction'
import { useState } from 'react'
import {
  isAuthorizationRequest,
  isPromptInteraction,
  queuedRequestCount,
} from '../lib/agent-authorization-ribbon-model'
import { agentLoopInteractionMessage } from '../lib/agent-loop-interaction-view'
import { restoreFocusBeforeRequest } from '../lib/pending-request-focus'
import { AgentAuthorizationRibbon } from './AgentAuthorizationRibbon'
import { AgentInteractionControls } from './AgentInteractionControls'
import { useChatDisplayText } from './ChatDisplayPathContext'
import { PoliteAnnouncer } from './PoliteAnnouncer'

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
    onRespond(interaction, response)
      .then(() => {
        // Every control here is `disabled={busy}`, and disabling the focused element blurs it, so
        // answering by keyboard moved focus to `<body>`: Escape stopped working and the next Tab
        // restarted from the top of the document, mid-sentence. Hand the caret back instead.
        restoreFocusBeforeRequest()
      })
      .catch((cause: unknown) => {
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
  const displayMessage = useChatDisplayText(message ?? '')
  const displayTitle = useChatDisplayText(
    'title' in interaction ? interaction.title : 'Waiting for your answer',
  )
  const displayError = useChatDisplayText(error ?? '')
  const titleId = `question-${interaction.interactionId}`

  return (
    <section
      aria-labelledby={titleId}
      className="border-b border-border/60 px-4 py-2.5"
      data-question-ribbon="true"
      data-request-ribbon="true"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        restoreFocusBeforeRequest()
      }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold tracking-widest text-accent uppercase">
              Waiting for you
            </span>
            {queuedCount > 0 ? (
              <span className="text-xs text-text-muted tabular-nums">1/{queuedCount + 1}</span>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-xs font-medium text-text-primary" id={titleId}>
            {displayTitle}
          </p>
          {displayMessage ? (
            <p className="mt-0.5 truncate text-xs text-text-muted">{displayMessage}</p>
          ) : null}
        </div>
      </div>

      <div className="mt-2">
        <AgentInteractionControls busy={busy} interaction={interaction} submit={submit} />
      </div>

      {displayError ? (
        <p className="mt-2 text-xs leading-5 text-error" role="alert">
          {displayError}
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
  const queuedCount = interaction === null ? 0 : queuedRequestCount(interactions)
  const announcement = useChatDisplayText(
    interaction === null ? '' : `Waiting for you. ${interaction.title}`,
  )

  // The announcer is rendered unconditionally, even with nothing to say. A live region only
  // announces content that changes *after* it is in the accessibility tree, so it cannot be mounted
  // alongside the ribbon it describes.
  return (
    <>
      <PoliteAnnouncer message={announcement || null} label="Agent request announcements" />
      {interaction === null ? null : isAuthorizationRequest(interaction) ? (
        <AgentAuthorizationRibbonContainer
          interaction={interaction}
          key={interaction.interactionId}
          onRespond={onRespond}
          projectName={projectName}
          queuedCount={queuedCount}
        />
      ) : (
        <AgentQuestionRibbon
          interaction={interaction}
          key={interaction.interactionId}
          onRespond={onRespond}
          queuedCount={queuedCount}
        />
      )}
    </>
  )
}
