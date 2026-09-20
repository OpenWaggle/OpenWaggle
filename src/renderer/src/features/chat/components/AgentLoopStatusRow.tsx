import { formatElapsed } from '@/features/chat/hooks/useStreamingPhase'
import { ExtensionAgentLoopSurface } from '@/features/extensions'
import { Spinner } from '@/shared/ui/Spinner'
import type { ChatRow } from '../lib/types-chat-row'
import type { ChatRowRenderContext } from './ChatRowRenderContext'

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

export function StatusRow({
  row,
  extensions,
}: {
  readonly row: Extract<ChatRow, { readonly type: 'phase-indicator' }>
  readonly extensions: ChatRowRenderContext['extensions']
}) {
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
