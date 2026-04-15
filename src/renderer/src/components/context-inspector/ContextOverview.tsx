import type { ConversationId } from '@shared/types/brand'
import type { ContextSnapshot } from '@shared/types/context'
import { Loader2, MessageSquarePlus, Pin, Shrink } from 'lucide-react'
import { setEditorText } from '@/components/composer/lexical-utils'
import { cn } from '@/lib/cn'
import { formatTokens } from '@/lib/format-tokens'
import { api } from '@/lib/ipc'
import { createRendererLogger } from '@/lib/logger'
import { useComposerStore } from '@/stores/composer-store'
import { useContextStore } from '@/stores/context-store'

const logger = createRendererLogger('context-overview')
const PERCENT_MULTIPLIER = 100
const MILLISECONDS_PER_SECOND = 1_000

interface ContextOverviewProps {
  readonly snapshot: ContextSnapshot | null
  readonly isCompacting: boolean
  readonly conversationId: ConversationId | null
}

const HEALTH_LABEL: Record<string, string> = {
  comfortable: 'Healthy',
  tight: 'Elevated',
  critical: 'Near limit',
  blocked: 'Over limit',
}

const HEALTH_DOT: Record<string, string> = {
  comfortable: 'bg-success',
  tight: 'bg-warning',
  critical: 'bg-warning',
  blocked: 'bg-error',
}

const HEALTH_BAR: Record<string, string> = {
  comfortable: 'bg-success/80',
  tight: 'bg-warning/80',
  critical: 'bg-warning/80',
  blocked: 'bg-error/80',
}

export function ContextOverview({ snapshot, isCompacting, conversationId }: ContextOverviewProps) {
  const hasConversation = conversationId !== null

  async function handleCompactNow() {
    if (!conversationId) return
    const { setCompacting } = useContextStore.getState()
    setCompacting(true)
    try {
      await api.requestCompaction(conversationId)
    } catch (err) {
      logger.warn('Manual compaction failed', { error: err })
    } finally {
      setCompacting(false)
    }
  }

  function handleCompactWithInstructions() {
    const { lexicalEditor } = useComposerStore.getState()
    if (!lexicalEditor) {
      logger.warn('Composer editor not available for /compact prefill')
      return
    }
    setEditorText(lexicalEditor, '/compact ')
    lexicalEditor.focus()
  }

  if (!snapshot) {
    return (
      <div className="px-4 py-5">
        <div className="h-1.5 w-full rounded-full bg-bg-hover" />
        <p className="mt-3 text-[11px] text-text-muted">Loading context...</p>
      </div>
    )
  }

  const percentUsed = Math.round(
    (snapshot.usedTokens / snapshot.contextWindow) * PERCENT_MULTIPLIER,
  )
  const healthLabel = HEALTH_LABEL[snapshot.healthStatus] ?? 'Unknown'
  const healthDot = HEALTH_DOT[snapshot.healthStatus] ?? 'bg-text-muted'
  const healthBar = HEALTH_BAR[snapshot.healthStatus] ?? 'bg-text-muted/40'

  return (
    <div className="px-4 py-4 space-y-4">
      {/* Usage bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[12px] text-text-secondary font-mono tabular-nums">
            {formatTokens(snapshot.usedTokens)}
            <span className="text-text-muted"> / {formatTokens(snapshot.contextWindow)}</span>
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-text-tertiary">
            <span className={cn('h-1.5 w-1.5 rounded-full', healthDot)} />
            {healthLabel}
          </span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-bg-hover overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all duration-500 ease-out', healthBar)}
            style={{ width: `${String(Math.min(PERCENT_MULTIPLIER, percentUsed))}%` }}
          />
        </div>
      </div>

      {/* Model + pinned row */}
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-text-muted font-mono">{snapshot.modelDisplayName}</span>
        {snapshot.pinnedItemCount > 0 && (
          <span className="flex items-center gap-1 text-text-muted">
            <Pin className="h-2.5 w-2.5" />
            {snapshot.pinnedItemCount} pinned · {formatTokens(snapshot.pinnedTokens)}
          </span>
        )}
      </div>

      {/* Microcompaction info */}
      {snapshot.microcompactedToolResults !== undefined &&
        snapshot.microcompactedToolResults > 0 && (
          <div className="text-[11px] text-text-muted">
            {snapshot.microcompactedToolResults} old tool results cleared
          </div>
        )}

      {/* Last compaction */}
      {snapshot.lastCompaction && (
        <div className="text-[11px] text-text-muted">
          Compacted {formatTimeAgo(snapshot.lastCompaction.timestamp)} —{' '}
          {formatTokens(snapshot.lastCompaction.tokensBefore)} →{' '}
          {formatTokens(snapshot.lastCompaction.tokensAfter)}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        {/* Primary: Compact now */}
        <button
          type="button"
          onClick={() => void handleCompactNow()}
          disabled={isCompacting || !hasConversation}
          className={cn(
            'flex items-center gap-1.5 h-[28px] px-3 rounded-md text-[12px] font-medium transition-colors',
            isCompacting || !hasConversation
              ? 'bg-bg-hover text-text-muted cursor-not-allowed'
              : 'bg-accent/10 text-accent border border-accent/20 hover:bg-accent/15',
          )}
        >
          {isCompacting ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Shrink className="h-3 w-3" />
          )}
          Compact now
        </button>

        {/* Secondary: With instructions */}
        {hasConversation && (
          <button
            type="button"
            onClick={handleCompactWithInstructions}
            className="flex items-center gap-1.5 h-[28px] px-3 rounded-md border border-button-border text-[12px] text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
          >
            <MessageSquarePlus className="h-3 w-3" />
            With instructions
          </button>
        )}
      </div>
    </div>
  )
}

const SECONDS_PER_MINUTE = 60

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / MILLISECONDS_PER_SECOND)
  if (seconds < SECONDS_PER_MINUTE) return 'just now'
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE)
  if (minutes < SECONDS_PER_MINUTE) return `${String(minutes)}m ago`
  const hours = Math.floor(minutes / SECONDS_PER_MINUTE)
  return `${String(hours)}h ago`
}
