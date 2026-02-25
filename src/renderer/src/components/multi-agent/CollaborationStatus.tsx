import { AlertTriangle, Loader2, X } from 'lucide-react'
import { AGENT_BG } from '@/lib/agent-colors'
import { cn } from '@/lib/cn'
import { useMultiAgentStore } from '@/stores/multi-agent-store'

interface CollaborationStatusProps {
  onStop: () => void
}

export function CollaborationStatus({
  onStop,
}: CollaborationStatusProps): React.JSX.Element | null {
  const status = useMultiAgentStore((s) => s.status)
  const config = useMultiAgentStore((s) => s.activeConfig)
  const currentTurn = useMultiAgentStore((s) => s.currentTurn)
  const currentAgentLabel = useMultiAgentStore((s) => s.currentAgentLabel)
  const fileConflicts = useMultiAgentStore((s) => s.fileConflicts)
  const completionReason = useMultiAgentStore((s) => s.completionReason)
  const clearConfig = useMultiAgentStore((s) => s.clearConfig)
  const reset = useMultiAgentStore((s) => s.reset)

  if (!config) return null

  function handleDismiss(): void {
    if (status === 'running') {
      onStop()
    }
    reset()
  }

  return (
    <div className="mx-auto w-full max-w-[720px] px-5 pb-2 space-y-1.5">
      <div
        className={cn(
          'flex items-center gap-3 rounded-lg border px-3 py-2',
          status === 'idle'
            ? 'border-[#f5a623]/20 bg-[#f5a623]/5'
            : 'border-border bg-bg-secondary',
        )}
      >
        {/* Agent dots — always visible */}
        <div className="flex items-center gap-1.5 shrink-0">
          {config.agents.map((agent) => (
            <div key={agent.label} className="flex items-center gap-1">
              <div className={cn('h-2 w-2 rounded-full', AGENT_BG[agent.color])} />
              <span className="text-[11px] font-medium text-text-secondary">{agent.label}</span>
            </div>
          ))}
        </div>

        <div className="h-3 w-px bg-border shrink-0" />

        {/* Status-specific content */}
        {status === 'idle' && (
          <span className="text-[12px] text-text-tertiary truncate">
            {config.mode === 'sequential' ? 'Sequential' : 'Parallel'} — send a message to start
          </span>
        )}

        {status === 'running' && (
          <div className="flex items-center gap-2 min-w-0">
            <Loader2 className="h-3 w-3 animate-spin text-accent shrink-0" />
            <span className="text-[12px] text-text-secondary truncate">
              Turn {currentTurn + 1}: {currentAgentLabel}
            </span>
          </div>
        )}

        {status === 'completed' && (
          <span className="text-[12px] text-text-secondary truncate">
            {completionReason ?? 'Collaboration complete'}
          </span>
        )}

        {status === 'stopped' && (
          <span className="text-[12px] text-text-muted truncate">Stopped by user</span>
        )}

        {/* Dismiss — always available */}
        <button
          type="button"
          onClick={status === 'idle' ? clearConfig : handleDismiss}
          className="ml-auto shrink-0 rounded-md p-1 text-text-muted hover:text-text-primary hover:bg-[#1e2229] transition-colors"
          title={status === 'running' ? 'Stop & dismiss co-work' : 'Dismiss co-work'}
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      {/* File conflict warnings — only during/after run */}
      {fileConflicts.length > 0 && (
        <div className="space-y-1">
          {fileConflicts.slice(-3).map((conflict, i) => (
            <div
              key={`${conflict.path}-${String(i)}`}
              className="flex items-center gap-2 rounded-md border border-warning/20 bg-warning/5 px-2.5 py-1.5"
            >
              <AlertTriangle className="h-3 w-3 shrink-0 text-warning" />
              <span className="text-[11px] text-warning/90">
                {conflict.currentAgent} edited {conflict.path} (previously by{' '}
                {conflict.previousAgent})
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
