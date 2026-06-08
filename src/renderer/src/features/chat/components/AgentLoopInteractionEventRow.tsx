import type {
  AgentTransportInteractionRequestEvent,
  AgentTransportInteractionResolvedEvent,
} from '@shared/types/stream'
import { ExtensionAgentLoopSurface } from '@/features/extensions'
import {
  agentLoopInteractionTitle,
  toExtensionInteractionView,
} from '../lib/agent-loop-interaction-view'
import type { ChatRowRenderContext } from './ChatRowRenderContext'

const RESPONSE_JSON_INDENT = 2

function eventTimeLabel(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function renderInteractionRequestAuditCard(event: AgentTransportInteractionRequestEvent) {
  return (
    <section className="rounded-xl border border-border bg-bg-secondary/70 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[12px] font-semibold text-text-primary">Interaction requested</h3>
        <span className="text-[11px] text-text-muted tabular-nums">
          {eventTimeLabel(event.timestamp)}
        </span>
      </div>
      <p className="mt-1 text-[12px] text-text-secondary">
        {agentLoopInteractionTitle(event.interaction)}
      </p>
      <p className="mt-1 text-[11px] text-text-tertiary">
        {event.interaction.kind} · {event.interaction.source}
      </p>
    </section>
  )
}

function renderInteractionResolvedAuditCard(event: AgentTransportInteractionResolvedEvent) {
  return (
    <section className="rounded-xl border border-border bg-bg-secondary/70 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[12px] font-semibold text-text-primary">Interaction resolved</h3>
        <span className="text-[11px] text-text-muted tabular-nums">
          {eventTimeLabel(event.timestamp)}
        </span>
      </div>
      <p className="mt-1 text-[12px] text-text-secondary">
        {event.kind} · {event.status}
      </p>
      {event.error ? (
        <p className="mt-1 text-[12px] text-error">{event.error.message}</p>
      ) : event.response ? (
        <pre className="mt-2 max-h-24 overflow-auto rounded-lg bg-bg-tertiary p-2 text-[11px] leading-5 text-text-tertiary">
          {JSON.stringify(event.response, null, RESPONSE_JSON_INDENT)}
        </pre>
      ) : null}
    </section>
  )
}

export function InteractionEventRow({
  event,
  extensions,
}: {
  readonly event: AgentTransportInteractionRequestEvent | AgentTransportInteractionResolvedEvent
  readonly extensions: ChatRowRenderContext['extensions']
}) {
  if (event.type === 'agent_interaction_request') {
    return (
      <div className="grid gap-3">
        {renderInteractionRequestAuditCard(event)}
        <ExtensionAgentLoopSurface
          fallback={null}
          input={{
            surface: 'interaction',
            interaction: toExtensionInteractionView(event.interaction),
          }}
          projectPaths={extensions.projectPaths}
          registry={extensions.registry}
        />
      </div>
    )
  }

  return renderInteractionResolvedAuditCard(event)
}
