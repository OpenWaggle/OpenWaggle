import { formatElapsed } from '@/features/chat/hooks/useStreamingPhase'
import { ExtensionAgentLoopSurface } from '@/features/extensions'
import type { ChatRow } from '../lib/types-chat-row'
import type { ChatRowRenderContext } from './ChatRowRenderContext'

/**
 * The live status band (ADR 0034), mirroring the T3 Code working row: quiet text
 * with a self-updating tabular timer, a hairline separating it from the turn's output.
 */
function CorePhaseIndicator({
  label,
  elapsedMs,
}: {
  readonly label: string
  readonly elapsedMs: number
}) {
  return (
    <div className="border-b border-border pb-2 pt-1">
      <div className="flex h-6 min-w-0 items-baseline px-1 text-sm leading-relaxed text-text-tertiary tabular-nums">
        <span className="truncate">
          {elapsedMs > 0 ? `${label} for ${formatElapsed(elapsedMs)}` : `${label}...`}
        </span>
      </div>
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
