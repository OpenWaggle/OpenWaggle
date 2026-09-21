import type { SessionFollowUpQueueItem } from '@/features/chat/hooks'

function queueCallerLabel(callerId: string | undefined) {
  if (!callerId) return undefined
  if (callerId.startsWith('session-agent:')) return 'From Worker'
  if (callerId.startsWith('profile:')) return 'From profile'
  if (callerId.startsWith('transient-mcp:')) return 'From MCP'
  if (callerId === 'gui:local-user') return 'From OpenWaggle'
  if (callerId.startsWith('local-user:')) return 'From CLI'
  return 'From agent'
}

export function QueueIntentBadges({ item }: { readonly item: SessionFollowUpQueueItem }) {
  if (!item.wagglePresetName && !item.authorizationMode && !item.thinkingLevel && !item.callerId) {
    return null
  }
  const callerLabel = queueCallerLabel(item.callerId)
  return (
    <div className="flex flex-wrap items-center gap-1">
      {item.wagglePresetName ? (
        <span className="rounded bg-accent/8 px-1.5 py-0.5 text-xs text-accent">
          Waggle · {item.wagglePresetName}
        </span>
      ) : null}
      {item.waggleSource ? (
        <span className="rounded bg-bg-hover px-1.5 py-0.5 text-xs text-text-tertiary">
          {item.waggleSource === 'agent' ? 'From agent' : 'From user'}
        </span>
      ) : null}
      {item.authorizationMode ? (
        <span className="rounded bg-bg-hover px-1.5 py-0.5 text-xs text-text-tertiary">
          {item.authorizationMode === 'yolo' ? 'YOLO access' : 'Ask for approval'}
        </span>
      ) : null}
      {item.thinkingLevel ? (
        <span className="rounded bg-bg-hover px-1.5 py-0.5 text-xs text-text-tertiary">
          Thinking · {item.thinkingLevel}
        </span>
      ) : null}
      {callerLabel ? (
        <span
          className="rounded bg-bg-hover px-1.5 py-0.5 text-xs text-text-tertiary"
          title={item.callerId}
        >
          {callerLabel}
        </span>
      ) : null}
    </div>
  )
}
