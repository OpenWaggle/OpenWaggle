import type {
  AgentTransportInteractionRequestEvent,
  AgentTransportInteractionResolvedEvent,
} from '@shared/types/stream'
import { formatElapsed } from '@/features/chat/hooks/useStreamingPhase'
import { ExtensionAgentLoopSurface } from '@/features/extensions'
import { Spinner } from '@/shared/ui/Spinner'
import {
  agentLoopInteractionTitle,
  toExtensionInteractionView,
} from '../lib/agent-loop-interaction-view'
import type { ChatRow } from '../lib/types-chat-row'
import type { ChatRowRenderContext } from './ChatRowRenderContext'
import { RunSummary } from './RunSummary'

const RESPONSE_JSON_INDENT = 2

function CorePhaseIndicator({
  label,
  elapsedMs,
}: {
  readonly label: string
  readonly elapsedMs: number
}) {
  return (
    <div className="flex items-center gap-2 py-3">
      <Spinner size="sm" className="text-accent" />
      <span className="text-sm text-text-tertiary">{label}...</span>
      {elapsedMs > 0 ? (
        <span className="text-sm text-text-muted tabular-nums">{formatElapsed(elapsedMs)}</span>
      ) : null}
    </div>
  )
}

function eventTimeLabel(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function InteractionRequestAuditCard({
  event,
}: {
  readonly event: AgentTransportInteractionRequestEvent
}) {
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

function InteractionResolvedAuditCard({
  event,
}: {
  readonly event: AgentTransportInteractionResolvedEvent
}) {
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
        <InteractionRequestAuditCard event={event} />
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

  return <InteractionResolvedAuditCard event={event} />
}

export function CustomMessageRow({
  row,
  extensions,
}: {
  readonly row: Extract<ChatRow, { readonly type: 'agent-loop-custom-message' }>
  readonly extensions: ChatRowRenderContext['extensions']
}) {
  return (
    <ExtensionAgentLoopSurface
      input={{
        surface: 'custom-message',
        message: { name: row.event.name, value: row.event.value ?? null },
      }}
      projectPaths={extensions.projectPaths}
      registry={extensions.registry}
    />
  )
}

export function StatusRow({
  row,
  extensions,
}: {
  readonly row: Extract<ChatRow, { readonly type: 'phase-indicator' | 'run-summary' }>
  readonly extensions: ChatRowRenderContext['extensions']
}) {
  if (row.type === 'run-summary') {
    return (
      <ExtensionAgentLoopSurface
        fallback={<RunSummary phases={row.phases} totalMs={row.totalMs} />}
        input={{
          surface: 'status',
          status: { label: 'Run complete', detail: formatElapsed(row.totalMs), tone: 'success' },
        }}
        projectPaths={extensions.projectPaths}
        registry={extensions.registry}
      />
    )
  }

  return (
    <ExtensionAgentLoopSurface
      fallback={<CorePhaseIndicator elapsedMs={row.elapsedMs} label={row.label} />}
      input={{
        surface: 'status',
        status: {
          label: `${row.label}...`,
          detail: row.elapsedMs > 0 ? formatElapsed(row.elapsedMs) : undefined,
          tone: 'running',
        },
      }}
      projectPaths={extensions.projectPaths}
      registry={extensions.registry}
    />
  )
}
