import type {
  AgentLoopInteraction,
  AgentLoopInteractionResponse,
} from '@shared/types/agent-loop-interaction'
import type { ExtensionContributionRegistryView } from '@shared/types/extensions'
import type { JsonValue } from '@shared/types/json'
import { MessageSquareWarning } from 'lucide-react'
import {
  ExtensionAgentLoopStatusWidgets,
  ExtensionAgentLoopSurface,
  type ExtensionAgentLoopSurfaceInput,
} from '@/features/extensions'
import { responseFromExtensionAction } from '../lib/agent-loop-interaction-response-actions'
import {
  agentLoopInteractionMessage,
  agentLoopInteractionRequiresDesktopRenderer,
  agentLoopInteractionTitle,
  toExtensionInteractionView,
} from '../lib/agent-loop-interaction-view'
import { AgentInteractionControls } from './AgentInteractionControls'

type InteractionSurfaceInput = Extract<
  ExtensionAgentLoopSurfaceInput,
  { readonly surface: 'interaction' }
>
type SubmitInteractionResponse = (
  interaction: AgentLoopInteraction,
  response: AgentLoopInteractionResponse,
) => void

function InteractionHeader({ interaction }: { readonly interaction: AgentLoopInteraction }) {
  return (
    <div className="flex items-start gap-3">
      <MessageSquareWarning className="mt-0.5 size-4 shrink-0 text-accent" />
      <div className="min-w-0">
        <h3 className="text-[13px] font-semibold text-text-primary">Pi interaction pending</h3>
        <p className="mt-1 text-[12px] leading-5 text-text-tertiary">
          {interaction.kind} · {interaction.source}
        </p>
      </div>
    </div>
  )
}

function interactionSurfaceInput(interaction: AgentLoopInteraction): InteractionSurfaceInput {
  return {
    surface: 'interaction',
    interaction: toExtensionInteractionView(interaction),
  }
}

function InteractionExtensionSurfaces({
  interaction,
  busy,
  extensionRegistry,
  extensionProjectPaths,
  submit,
}: {
  readonly interaction: AgentLoopInteraction
  readonly busy: boolean
  readonly extensionRegistry: ExtensionContributionRegistryView | null
  readonly extensionProjectPaths: readonly string[]
  readonly submit: SubmitInteractionResponse
}) {
  const extensionInput = interactionSurfaceInput(interaction)
  const requiresDesktopRenderer = agentLoopInteractionRequiresDesktopRenderer(interaction)
  const extensionFallback = requiresDesktopRenderer ? undefined : null
  const handleSurfaceAction = busy
    ? undefined
    : (actionId: string, payload?: JsonValue) => {
        const response = responseFromExtensionAction({
          interaction,
          actionId,
          payload,
        })
        if (response !== null) {
          submit(interaction, response)
        }
      }
  const primaryInput: InteractionSurfaceInput =
    handleSurfaceAction === undefined
      ? extensionInput
      : {
          ...extensionInput,
          onAction: (interactionId, actionId, payload) => {
            if (interactionId !== interaction.interactionId) {
              return
            }

            handleSurfaceAction(actionId, payload)
          },
        }

  return (
    <>
      <ExtensionAgentLoopSurface
        fallback={extensionFallback}
        input={primaryInput}
        projectPaths={extensionProjectPaths}
        registry={extensionRegistry}
      />
      <ExtensionAgentLoopStatusWidgets
        input={extensionInput}
        onSurfaceAction={handleSurfaceAction}
        projectPaths={extensionProjectPaths}
        registry={extensionRegistry}
      />
    </>
  )
}

function InteractionSummary({ interaction }: { readonly interaction: AgentLoopInteraction }) {
  const message = agentLoopInteractionMessage(interaction)

  return (
    <div>
      <div className="text-[13px] font-medium text-text-primary">
        {agentLoopInteractionTitle(interaction)}
      </div>
      {message ? <p className="mt-1 text-[12px] leading-5 text-text-tertiary">{message}</p> : null}
    </div>
  )
}

export function AgentInteractionCard({
  interaction,
  busy,
  extensionRegistry,
  extensionProjectPaths,
  submit,
}: {
  readonly interaction: AgentLoopInteraction
  readonly busy: boolean
  readonly extensionRegistry: ExtensionContributionRegistryView | null
  readonly extensionProjectPaths: readonly string[]
  readonly submit: SubmitInteractionResponse
}) {
  return (
    <section className="grid gap-3 rounded-xl border border-accent/25 bg-accent/5 p-3">
      <InteractionHeader interaction={interaction} />
      <InteractionExtensionSurfaces
        busy={busy}
        extensionProjectPaths={extensionProjectPaths}
        extensionRegistry={extensionRegistry}
        interaction={interaction}
        submit={submit}
      />
      <InteractionSummary interaction={interaction} />
      <AgentInteractionControls
        interaction={interaction}
        busy={busy}
        submit={(response) => submit(interaction, response)}
      />
    </section>
  )
}
