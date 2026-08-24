import type { AgentLoopInteraction } from '@shared/types/agent-loop-interaction'
import type { AgentTransportInteractionResolvedEvent } from '@shared/types/stream'
import { notificationCreatesDurableRecord } from '@shared/utils/agent-notification-durability'
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  CircleSlash,
  Clock3,
  type LucideIcon,
  ShieldCheck,
  XCircle,
} from 'lucide-react'
import { ExtensionAgentLoopSurface } from '@/features/extensions'
import { cn } from '@/shared/lib/cn'
import {
  agentLoopInteractionMessage,
  agentLoopInteractionRequiresDesktopRenderer,
  agentLoopInteractionTitle,
  toExtensionInteractionView,
} from '../lib/agent-loop-interaction-view'
import type { AgentInteractionTranscriptItem } from '../lib/types-chat-row'
import { InteractionMessage } from './AgentInteractionMessage'
import type { ChatRowRenderContext } from './ChatRowRenderContext'

function eventTimeLabel(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function extensionInteractionState(resolution: AgentTransportInteractionResolvedEvent | undefined) {
  if (!resolution) {
    return 'pending'
  }

  return resolution.status === 'resolved' ? 'submitted' : 'cancelled'
}

function interactionEyebrow(interaction: AgentLoopInteraction) {
  if (interaction.kind === 'confirm') {
    return interaction.purpose === 'authorization'
      ? 'Authorization requested'
      : 'Confirmation requested'
  }

  if (interaction.kind === 'select') {
    return 'Selection requested'
  }

  if (interaction.kind === 'input' || interaction.kind === 'editor') {
    return 'Input requested'
  }

  if (interaction.kind === 'custom') {
    return 'Custom interaction'
  }

  return interaction.level === 'error' ? 'Error notification' : 'Warning notification'
}

type StatusTone = 'pending' | 'success' | 'error' | 'muted'

interface StatusView {
  readonly label: string
  readonly tone: StatusTone
  readonly icon: LucideIcon
}

function pendingStatus(): StatusView {
  return { label: 'Waiting', tone: 'pending', icon: Clock3 }
}

function completedStatus(): StatusView {
  return { label: 'Completed', tone: 'success', icon: CheckCircle2 }
}

function terminalStatus(resolution: AgentTransportInteractionResolvedEvent): StatusView | null {
  if (resolution.status === 'errored') {
    return { label: 'Failed', tone: 'error', icon: XCircle }
  }

  if (resolution.status === 'cancelled') {
    return { label: 'Cancelled', tone: 'muted', icon: CircleSlash }
  }

  return null
}

function confirmStatus(
  interaction: Extract<AgentLoopInteraction, { kind: 'confirm' }>,
  accepted: boolean,
): StatusView {
  if (!accepted) {
    return {
      label: interaction.purpose === 'authorization' ? 'Denied' : 'Cancelled',
      tone: 'muted',
      icon: CircleSlash,
    }
  }

  return {
    label: interaction.purpose === 'authorization' ? 'Allowed' : 'Confirmed',
    tone: 'success',
    icon: CheckCircle2,
  }
}

function selectStatus(selected: string | null): StatusView {
  return {
    label: selected ? `Selected: ${selected}` : 'No selection',
    tone: selected ? 'success' : 'muted',
    icon: selected ? CheckCircle2 : CircleSlash,
  }
}

function textStatus(value: string | null): StatusView {
  return {
    label: value === null ? 'Cancelled' : 'Submitted',
    tone: value === null ? 'muted' : 'success',
    icon: value === null ? CircleSlash : CheckCircle2,
  }
}

function statusLabel(input: {
  readonly interaction: AgentLoopInteraction
  readonly resolution?: AgentTransportInteractionResolvedEvent
}): StatusView {
  const { interaction, resolution } = input
  if (!resolution) return pendingStatus()

  const terminal = terminalStatus(resolution)
  if (terminal) return terminal

  if (interaction.kind === 'confirm' && resolution.response?.kind === 'confirm') {
    return confirmStatus(interaction, resolution.response.accepted)
  }

  if (interaction.kind === 'select' && resolution.response?.kind === 'select') {
    return selectStatus(resolution.response.selected)
  }

  if (
    (interaction.kind === 'input' && resolution.response?.kind === 'input') ||
    (interaction.kind === 'editor' && resolution.response?.kind === 'editor')
  ) {
    return textStatus(resolution.response.value)
  }

  return completedStatus()
}

function statusClassName(tone: StatusTone) {
  if (tone === 'success') {
    return 'border-success/25 bg-success/10 text-success'
  }

  if (tone === 'error') {
    return 'border-error/25 bg-error/10 text-error'
  }

  if (tone === 'muted') {
    return 'border-border bg-bg-tertiary text-text-tertiary'
  }

  return 'border-accent/25 bg-accent/10 text-accent'
}

function InteractionStatusBadge({
  interaction,
  resolution,
}: {
  readonly interaction: AgentLoopInteraction
  readonly resolution?: AgentTransportInteractionResolvedEvent
}) {
  const status = statusLabel({ interaction, resolution })
  const Icon = status.icon
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium',
        statusClassName(status.tone),
      )}
    >
      <Icon className="size-3" />
      {status.label}
    </span>
  )
}

function NotificationRow({ item }: { readonly item: AgentInteractionTranscriptItem }) {
  const interaction = item.request.interaction
  if (interaction.kind !== 'notify') {
    return null
  }

  // An informational notice is ephemeral and leaves no durable record. The projection already drops
  // it, so reaching here means something upstream changed; render nothing rather than dress it as a
  // warning, which is what this row would otherwise do to any level that is not an error.
  if (!notificationCreatesDurableRecord(interaction.level)) {
    return null
  }

  const isError = interaction.level === 'error'
  const Icon = isError ? AlertTriangle : Bell
  return (
    <section
      className={cn(
        'rounded-xl border p-3 shadow-[0_18px_48px_-36px_rgb(0_0_0/0.9)]',
        isError ? 'border-error/30 bg-error/10' : 'border-warning/30 bg-warning/10',
      )}
    >
      <div className="flex items-start gap-3">
        <Icon className={cn('mt-0.5 size-4 shrink-0', isError ? 'text-error' : 'text-warning')} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[12px] font-semibold text-text-primary">
              {interactionEyebrow(interaction)}
            </h3>
            <span className="text-[11px] text-text-muted tabular-nums">
              {eventTimeLabel(item.request.timestamp)}
            </span>
          </div>
          <p className="mt-1 text-[12px] leading-5 text-text-secondary">{interaction.message}</p>
        </div>
      </div>
    </section>
  )
}

function StandardInteractionRow({
  item,
  extensions,
}: {
  readonly item: AgentInteractionTranscriptItem
  readonly extensions: ChatRowRenderContext['extensions']
}) {
  const { interaction } = item.request
  const message = agentLoopInteractionMessage(interaction)
  const requiresDesktopRenderer = agentLoopInteractionRequiresDesktopRenderer(interaction)
  const fallback = requiresDesktopRenderer ? undefined : null
  const Icon =
    interaction.kind === 'confirm' && interaction.purpose === 'authorization' ? ShieldCheck : Bell

  return (
    <section className="grid gap-3 rounded-xl border border-border bg-bg-secondary/70 p-3">
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 size-4 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-text-muted">
                {interactionEyebrow(interaction)}
              </p>
              <h3 className="mt-1 truncate text-[13px] font-semibold text-text-primary">
                {agentLoopInteractionTitle(interaction)}
              </h3>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <InteractionStatusBadge interaction={interaction} resolution={item.resolution} />
              <span className="text-[11px] text-text-muted tabular-nums">
                {eventTimeLabel(item.request.timestamp)}
              </span>
            </div>
          </div>
          {message ? <InteractionMessage message={message} /> : null}
          {item.resolution?.error ? (
            <p className="mt-2 text-[12px] leading-5 text-error">{item.resolution.error.message}</p>
          ) : null}
        </div>
      </div>

      {interaction.kind === 'custom' ? (
        <ExtensionAgentLoopSurface
          fallback={fallback}
          input={{
            surface: 'interaction',
            interaction: toExtensionInteractionView(
              interaction,
              extensionInteractionState(item.resolution),
            ),
          }}
          projectPaths={extensions.projectPaths}
          registry={extensions.registry}
        />
      ) : null}
    </section>
  )
}

export function InteractionEventRow({
  item,
  extensions,
}: {
  readonly item: AgentInteractionTranscriptItem
  readonly extensions: ChatRowRenderContext['extensions']
}) {
  if (item.request.interaction.kind === 'notify') {
    return <NotificationRow item={item} />
  }

  return <StandardInteractionRow item={item} extensions={extensions} />
}
