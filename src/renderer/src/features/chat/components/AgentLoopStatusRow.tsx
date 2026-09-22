import { TIME_UNIT } from '@shared/constants/time'
import { formatElapsed } from '@/features/chat/hooks/useStreamingPhase'
import { ExtensionAgentLoopSurface } from '@/features/extensions'
import { cn } from '@/shared/lib/cn'
import type { ChatRow } from '../lib/types-chat-row'
import type { ChatRowRenderContext } from './ChatRowRenderContext'

type StatusChatRow = Extract<ChatRow, { readonly type: 'phase-indicator' | 'retry-status' }>

function CoreStatusIndicator({
  text,
  separated,
}: {
  readonly text: string
  readonly separated: boolean
}) {
  return (
    <div className={cn('pb-2 pt-1', separated && 'border-b border-border')}>
      <div className="flex h-6 min-w-0 items-baseline px-1 text-sm leading-relaxed text-text-tertiary tabular-nums">
        <span className="truncate">{text}</span>
      </div>
    </div>
  )
}

function retryLabel(row: Extract<StatusChatRow, { readonly type: 'retry-status' }>) {
  const seconds = Math.ceil(row.delayMs / TIME_UNIT.MILLISECONDS_PER_SECOND)
  return `Retrying (${String(row.attempt)}/${String(row.maxAttempts)}) in ${String(seconds)}s…`
}

export function StatusRow({
  row,
  extensions,
}: {
  readonly row: StatusChatRow
  readonly extensions: ChatRowRenderContext['extensions']
}) {
  const isRetry = row.type === 'retry-status'
  const label = isRetry
    ? retryLabel(row)
    : row.elapsedMs > 0
      ? `${row.label} for ${formatElapsed(row.elapsedMs)}`
      : `${row.label}...`

  return (
    <ExtensionAgentLoopSurface
      fallback={
        <CoreStatusIndicator
          text={label}
          separated={!isRetry && row.type === 'phase-indicator' && row.label !== 'Thinking'}
        />
      }
      input={{
        surface: 'status',
        status: isRetry
          ? { label, tone: 'warning' }
          : {
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
