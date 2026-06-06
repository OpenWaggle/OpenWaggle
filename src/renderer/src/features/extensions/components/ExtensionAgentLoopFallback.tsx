import type { ChatToolCallPart } from '@shared/types/chat-ui'
import { AlertTriangle, CheckCircle2, CircleDashed, MessagesSquare, Wrench } from 'lucide-react'
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

const JSON_INDENT = 2

function prettyJson(value: ExtensionCustomMessageView['value']) {
  return JSON.stringify(value, null, JSON_INDENT)
}

function StatusIcon({ tone }: { readonly tone: ExtensionStatusView['tone'] }) {
  if (tone === 'success') {
    return <CheckCircle2 className="size-4 text-emerald-300" />
  }

  if (tone === 'warning' || tone === 'error') {
    return <AlertTriangle className="size-4 text-amber-300" />
  }

  return <CircleDashed className="size-4 text-accent" />
}

function ToolFallback({
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

function CustomMessageFallback({ message }: { readonly message: ExtensionCustomMessageView }) {
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

function InteractionFallback({
  interaction,
  onAction,
}: {
  readonly interaction: ExtensionInteractionView
  readonly onAction?: (interactionId: string, actionId: string) => void
}) {
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

function StatusFallback({ status }: { readonly status: ExtensionStatusView }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border/80 bg-bg-secondary/50 p-3">
      <StatusIcon tone={status.tone} />
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-text-primary">{status.label}</div>
        {status.detail ? (
          <p className="mt-1 text-[12px] leading-5 text-text-tertiary">{status.detail}</p>
        ) : null}
      </div>
    </div>
  )
}

function TranscriptFallback({ transcript }: { readonly transcript: ExtensionTranscriptView }) {
  return (
    <div className="rounded-lg border border-border/80 bg-bg-secondary/50 p-3">
      <div className="text-[13px] font-medium text-text-primary">Transcript extension card</div>
      <p className="mt-1 text-[12px] leading-5 text-text-tertiary">
        {transcript.messageCount} messages · {transcript.state}
      </p>
    </div>
  )
}

export function fallbackFor(input: ExtensionAgentLoopSurfaceInput) {
  if (input.surface === 'tool') {
    return <ToolFallback toolCall={input.toolCall} toolResult={input.toolResult} />
  }

  if (input.surface === 'custom-message') {
    return <CustomMessageFallback message={input.message} />
  }

  if (input.surface === 'interaction') {
    return <InteractionFallback interaction={input.interaction} onAction={input.onAction} />
  }

  if (input.surface === 'transcript') {
    return <TranscriptFallback transcript={input.transcript} />
  }

  return <StatusFallback status={input.status} />
}
