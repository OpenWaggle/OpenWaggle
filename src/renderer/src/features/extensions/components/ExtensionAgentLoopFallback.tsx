import { matchBy } from '@diegogbrisa/ts-match'
import type { ChatToolCallPart } from '@shared/types/chat-ui'
import { AlertTriangle, CheckCircle2, CircleDashed, MessagesSquare, Wrench } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/shared/ui/Button'
import type {
  ExtensionAgentLoopSurfaceInput,
  ExtensionCustomMessageView,
  ExtensionInteractionActionView,
  ExtensionInteractionView,
  ExtensionStatusView,
  ExtensionToolResultView,
  ExtensionTranscriptView,
} from '../lib/extension-agent-loop-surface-model'
import { CUSTOM_INTERACTION_UNAVAILABLE_ACTION_ID } from '../lib/extension-agent-loop-surface-model'

const JSON_INDENT = 2

function prettyJson(value: ExtensionCustomMessageView['value']) {
  return JSON.stringify(value, null, JSON_INDENT)
}

function renderToolFallback({
  toolCall,
  toolResult,
}: {
  readonly toolCall: ChatToolCallPart
  readonly toolResult?: ExtensionToolResultView
}) {
  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2 text-[13px] font-medium text-text-primary">
        <Wrench className="size-4 text-accent" />
        <span>{toolCall.name}</span>
        <span className="rounded bg-bg-tertiary px-2 py-0.5 text-[10px] text-text-tertiary">
          {toolCall.state}
        </span>
      </div>
      <pre className="max-h-40 overflow-auto rounded-lg border border-border/80 bg-bg p-3 text-[11px] leading-5 text-text-tertiary">
        {toolCall.arguments || '{}'}
      </pre>
      {toolResult ? (
        <div className="rounded-lg border border-border/80 bg-bg-secondary/50 p-3">
          <div className="mb-1 text-[10px] tracking-wide text-text-muted uppercase">
            Result · {toolResult.state}
          </div>
          <p className="whitespace-pre-wrap text-[12px] leading-5 text-text-secondary">
            {toolResult.error ?? toolResult.content}
          </p>
        </div>
      ) : null}
    </div>
  )
}

function renderCustomMessageFallback(message: ExtensionCustomMessageView) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2 text-[13px] font-medium text-text-primary">
        <MessagesSquare className="size-4 text-accent" />
        <span>{message.name}</span>
      </div>
      <pre className="max-h-48 overflow-auto rounded-lg border border-border/80 bg-bg p-3 text-[11px] leading-5 text-text-tertiary">
        {prettyJson(message.value)}
      </pre>
    </div>
  )
}

function actionVariant(tone: ExtensionInteractionActionView['tone']) {
  if (tone === 'primary') {
    return 'accent'
  }

  return 'secondary'
}

function renderInteractionFallback({
  interaction,
  onAction,
}: {
  readonly interaction: ExtensionInteractionView
  readonly onAction?: (interactionId: string, actionId: string) => void
}) {
  if (interaction.kind === 'custom') {
    return (
      <div role="alert" className="rounded-lg border border-error/25 bg-error/5 p-3">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-error" />
          <div className="min-w-0">
            <h4 className="text-[13px] font-semibold text-text-primary">
              Custom desktop interaction renderer unavailable
            </h4>
            <p className="mt-1 text-[12px] leading-5 text-text-tertiary">
              OpenWaggle does not execute Pi TUI custom components inside Electron. This interaction
              needs a matching extension interaction renderer.
            </p>
            <dl className="mt-3 grid gap-1 text-[11px] text-text-muted">
              <div className="flex min-w-0 gap-2">
                <dt className="shrink-0 text-text-tertiary">Interaction</dt>
                <dd className="truncate">{interaction.id}</dd>
              </div>
              <div className="flex min-w-0 gap-2">
                <dt className="shrink-0 text-text-tertiary">State</dt>
                <dd>{interaction.state}</dd>
              </div>
            </dl>
            {onAction ? (
              <div className="mt-3">
                <Button
                  onClick={() => onAction(interaction.id, CUSTOM_INTERACTION_UNAVAILABLE_ACTION_ID)}
                  size="xs"
                  type="button"
                  variant="secondary"
                >
                  Reject interaction
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="grid gap-3">
      <div>
        <h4 className="text-[13px] font-semibold text-text-primary">{interaction.title}</h4>
        {interaction.description ? (
          <p className="mt-1 text-[12px] leading-5 text-text-tertiary">{interaction.description}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {interaction.actions.map((action) => (
          <Button
            key={action.id}
            disabled={interaction.state !== 'pending'}
            onClick={() => onAction?.(interaction.id, action.id)}
            size="xs"
            type="button"
            variant={actionVariant(action.tone)}
          >
            {action.label}
          </Button>
        ))}
      </div>
      <div className="text-[11px] text-text-muted">State: {interaction.state}</div>
    </div>
  )
}

function renderStatusFallback(status: ExtensionStatusView) {
  const icon =
    status.tone === 'success' ? (
      <CheckCircle2 className="size-4 text-emerald-300" />
    ) : status.tone === 'warning' || status.tone === 'error' ? (
      <AlertTriangle className="size-4 text-amber-300" />
    ) : (
      <CircleDashed className="size-4 text-accent" />
    )

  return (
    <div className="flex items-start gap-3 rounded-lg border border-border/80 bg-bg-secondary/50 p-3">
      {icon}
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-text-primary">{status.label}</div>
        {status.detail ? (
          <p className="mt-1 text-[12px] leading-5 text-text-tertiary">{status.detail}</p>
        ) : null}
      </div>
    </div>
  )
}

function renderTranscriptFallback(transcript: ExtensionTranscriptView) {
  return (
    <div className="rounded-lg border border-border/80 bg-bg-secondary/50 p-3">
      <div className="text-[13px] font-medium text-text-primary">Transcript extension card</div>
      <p className="mt-1 text-[12px] leading-5 text-text-tertiary">
        {transcript.messageCount} messages · {transcript.state}
      </p>
    </div>
  )
}

function fallbackFor(input: ExtensionAgentLoopSurfaceInput): ReactNode {
  return matchBy(input, 'surface')
    .with('tool', (value) =>
      renderToolFallback({ toolCall: value.toolCall, toolResult: value.toolResult }),
    )
    .with('custom-message', (value) => renderCustomMessageFallback(value.message))
    .with('interaction', (value) =>
      renderInteractionFallback({ interaction: value.interaction, onAction: value.onAction }),
    )
    .with('transcript', (value) => renderTranscriptFallback(value.transcript))
    .with('status', (value) => renderStatusFallback(value.status))
    .exhaustive()
}

export function ExtensionAgentLoopFallback({
  input,
}: {
  readonly input: ExtensionAgentLoopSurfaceInput
}) {
  return fallbackFor(input)
}
