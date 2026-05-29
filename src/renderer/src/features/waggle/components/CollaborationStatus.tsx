import type { SessionId } from '@shared/types/brand'
import { generateDisplayName } from '@shared/types/llm'
import { isInheritedWaggleModelBinding, type WaggleAgentSlot } from '@shared/types/waggle'
import { AlertTriangle, Loader2, X } from 'lucide-react'
import { usePreferencesStore } from '@/features/settings/state'
import { AGENT_BG } from '@/features/waggle/lib/agent-colors'
import { useWaggleStore } from '@/features/waggle/state/waggle-store'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'

const SINGLE_TURN_COUNT = 1
const SLICE_ARG_1 = -3

interface CollaborationStatusProps {
  currentSessionId: SessionId | null
  onStop: () => void
}

function turnCountLabel(turnCount: number) {
  return `${String(turnCount)} ${turnCount === SINGLE_TURN_COUNT ? 'turn' : 'turns'}`
}

function displayModelForAgent(agent: WaggleAgentSlot, inheritedModel: string) {
  if (!isInheritedWaggleModelBinding(agent.model)) return generateDisplayName(agent.model)
  return inheritedModel.trim() ? generateDisplayName(inheritedModel) : 'Select model'
}

export function WaggleCollaborationStatus({ currentSessionId, onStop }: CollaborationStatusProps) {
  const selectedModel = usePreferencesStore((s) => s.settings.selectedModel)
  const status = useWaggleStore((s) => s.status)
  const config = useWaggleStore((s) => s.activeConfig)
  const activeCollaborationId = useWaggleStore((s) => s.activeCollaborationId)
  const configSessionId = useWaggleStore((s) => s.configSessionId)
  const currentTurn = useWaggleStore((s) => s.currentTurn)
  const currentAgentIndex = useWaggleStore((s) => s.currentAgentIndex)
  const currentAgentLabel = useWaggleStore((s) => s.currentAgentLabel)
  const fileConflicts = useWaggleStore((s) => s.fileConflicts)
  const completionReason = useWaggleStore((s) => s.completionReason)
  const clearConfig = useWaggleStore((s) => s.clearConfig)
  const reset = useWaggleStore((s) => s.reset)

  if (!config) return null

  // Scope: only show for the session that owns the waggle state
  const owningSessionId = activeCollaborationId ?? configSessionId
  if (owningSessionId && owningSessionId !== currentSessionId) return null
  const currentAgent = config.agents[currentAgentIndex]
  const maxTurns = config.stop.maxTurnsSafety

  function handleDismiss() {
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
        <div className="flex min-w-0 items-center gap-2 shrink-0">
          {config.agents.map((agent) => {
            const displayModel = displayModelForAgent(agent, selectedModel)
            return (
              <div
                key={`${agent.label}-${String(agent.model)}`}
                className="flex items-center gap-1"
                title={`${agent.label} · ${displayModel}`}
              >
                <div className={cn('size-2 rounded-full', AGENT_BG[agent.color])} />
                <span className="text-[11px] font-medium text-text-secondary">{agent.label}</span>
                <span className="hidden text-[11px] text-text-tertiary sm:inline">
                  · {displayModel}
                </span>
              </div>
            )
          })}
        </div>

        <div className="h-3 w-px bg-border shrink-0" />

        {/* Status-specific content */}
        {status === 'idle' && (
          <span className="text-[12px] text-text-tertiary truncate">
            Waggle ready · Sequential · {turnCountLabel(maxTurns)}: send a message to start
          </span>
        )}

        {status === 'running' && (
          <div className="flex items-center gap-2 min-w-0">
            <Loader2 className="size-3 animate-spin text-accent shrink-0" />
            <span className="text-[12px] text-text-secondary truncate">
              Turn {currentTurn + SINGLE_TURN_COUNT}/{maxTurns}: {currentAgentLabel}
              {currentAgent ? ` · ${displayModelForAgent(currentAgent, selectedModel)}` : ''}
            </span>
          </div>
        )}

        {status === 'completed' && (
          <span className="text-[12px] text-text-secondary truncate">
            Waggle complete · {completionReason ?? 'Collaboration complete'}
          </span>
        )}

        {status === 'stopped' && (
          <span className="text-[12px] text-text-muted truncate">Stopped by user</span>
        )}

        {/* Dismiss — always available */}
        <Button
          variant="unstyled"
          type="button"
          onClick={status === 'idle' ? clearConfig : handleDismiss}
          className="ml-auto shrink-0 rounded-md p-1 text-text-muted hover:text-text-primary hover:bg-[#1e2229] transition-colors"
          title={status === 'running' ? 'Stop & dismiss waggle' : 'Dismiss waggle'}
        >
          <X className="size-3" />
        </Button>
      </div>

      {/* File conflict warnings — only during/after run */}
      {fileConflicts.length > 0 && (
        <div className="space-y-1">
          {fileConflicts.slice(SLICE_ARG_1).map((conflict, i) => (
            <div
              key={`${conflict.path}-${String(i)}`}
              className="flex items-center gap-2 rounded-md border border-warning/20 bg-warning/5 px-2.5 py-1.5"
            >
              <AlertTriangle className="size-3 shrink-0 text-warning" />
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
