import type { Message } from '@shared/types/agent'
import type { WaggleContextInfo } from '@shared/types/context'
import { ChevronRight, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { cn } from '@/lib/cn'
import { formatContextWindow } from '@/lib/format-tokens'

interface WaggleSession {
  readonly sessionId: string
  readonly agents: ReadonlyMap<string, { label: string; color: string; model: string }>
  readonly turnCount: number
}

interface WaggleContextSectionProps {
  readonly activeWaggle: WaggleContextInfo | null
  readonly messages: readonly Message[]
}

/** Extract historical waggle sessions from persisted message metadata. */
function extractWaggleSessions(messages: readonly Message[]): WaggleSession[] {
  const sessionMap = new Map<
    string,
    { agents: Map<string, { label: string; color: string; model: string }>; turnCount: number }
  >()

  for (const msg of messages) {
    const waggle = msg.metadata?.waggle
    if (!waggle?.sessionId) continue

    let session = sessionMap.get(waggle.sessionId)
    if (!session) {
      session = { agents: new Map(), turnCount: 0 }
      sessionMap.set(waggle.sessionId, session)
    }

    session.turnCount++
    if (waggle.agentModel && !waggle.isSynthesis) {
      session.agents.set(String(waggle.agentModel), {
        label: waggle.agentLabel,
        color: waggle.agentColor,
        model: String(waggle.agentModel),
      })
    }
  }

  return Array.from(sessionMap.entries()).map(([sessionId, data]) => ({
    sessionId,
    agents: data.agents,
    turnCount: data.turnCount,
  }))
}

export function WaggleContextSection({ activeWaggle, messages }: WaggleContextSectionProps) {
  const [expanded, setExpanded] = useState(true)

  const historicalSessions = useMemo(() => extractWaggleSessions(messages), [messages])
  const hasContent = activeWaggle !== null || historicalSessions.length > 0

  if (!hasContent) return null

  return (
    <div className="border-t border-border">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-[12px] text-text-muted hover:text-text-secondary hover:bg-bg-hover/50 transition-colors"
      >
        <ChevronRight
          className={cn('h-3 w-3 transition-transform duration-150', expanded && 'rotate-90')}
        />
        <Users className="h-3 w-3" />
        <span className="font-medium">Waggle Context</span>
        {historicalSessions.length > 0 && !activeWaggle && (
          <span className="ml-auto rounded-full bg-bg-hover px-1.5 py-0.5 text-[10px] text-text-muted tabular-nums">
            {historicalSessions.length} session{historicalSessions.length > 1 ? 's' : ''}
          </span>
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-3">
          {/* Active waggle session */}
          {activeWaggle && (
            <div className="space-y-2">
              <p className="text-[11px] text-text-muted leading-relaxed">
                Multiple models participating. Compaction targets the smallest context window.
              </p>

              <div className="space-y-0.5">
                {activeWaggle.activeModels.map((model) => {
                  const isGoverning = model.modelId === activeWaggle.governingModelId
                  return (
                    <div
                      key={String(model.modelId)}
                      className={cn(
                        'flex items-center justify-between rounded-md px-2.5 py-1.5 text-[12px]',
                        isGoverning && 'bg-bg-hover/70',
                      )}
                    >
                      <span
                        className={cn(
                          'text-text-secondary',
                          isGoverning && 'font-medium text-text-primary',
                        )}
                      >
                        {model.displayName}
                        {isGoverning && (
                          <span className="ml-1.5 text-[10px] text-accent font-normal">
                            governing
                          </span>
                        )}
                      </span>
                      <span className="text-[10px] text-text-muted font-mono tabular-nums">
                        {formatContextWindow(model.contextWindow)}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Historical waggle sessions */}
          {historicalSessions.map((session) => (
            <div
              key={session.sessionId}
              className="rounded-lg bg-bg-tertiary/50 border border-border/50 px-3 py-2 space-y-1"
            >
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-medium text-text-secondary">Last waggle session</span>
                <span className="text-text-muted tabular-nums">
                  {session.turnCount} turn{session.turnCount > 1 ? 's' : ''}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-text-muted">
                {Array.from(session.agents.values()).map((agent) => (
                  <span key={agent.model}>
                    {agent.label} ({agent.model})
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
