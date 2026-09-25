import type { TurnCheckpointSummary } from '@shared/types/turn-diff'
import { useLayoutEffect, useRef, useState } from 'react'
import type { ChatRowRenderContext } from '../components/ChatRowRenderContext'
import type { ChatTranscriptSectionState } from '../model'

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  if (left.size !== right.size) return false
  for (const value of left) if (!right.has(value)) return false
  return true
}

function sameTurns(
  left: ReadonlyMap<string, TurnCheckpointSummary>,
  right: ReadonlyMap<string, TurnCheckpointSummary>,
) {
  if (left.size !== right.size) return false
  for (const [key, turn] of left) {
    const other = right.get(key)
    if (!other || other.turnId !== turn.turnId || other.turnIndex !== turn.turnIndex) return false
  }
  return true
}

function sameList(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

type Section = ChatTranscriptSectionState

/** The value of `next`, but the previous instance when its contents did not change. */
function useContentStable<T>(next: T, same: (left: T, right: T) => boolean) {
  const [held, setHeld] = useState(next)
  if (held !== next && !same(held, next)) {
    setHeld(next)
    return next
  }
  return held
}

/**
 * The row render context, with an identity that survives streamed tokens.
 *
 * The section object, its callbacks, and its turn maps are rebuilt on every render, so a context
 * built from them changed identity per token and re-rendered every mounted message bubble (about
 * 1,100 re-rendered components per commit with 40 rows). Callbacks now go through the latest
 * section, and data is replaced only when its contents change.
 */
export function useStableRowContext(section: Section): ChatRowRenderContext {
  const latest = useRef(section)
  useLayoutEffect(() => {
    latest.current = section
  })
  const [callbacks] = useState(() => ({
    onDismissInterruptedRun: (...args: Parameters<Section['onDismissInterruptedRun']>) =>
      latest.current.onDismissInterruptedRun(...args),
    onBranchFromMessage: (messageId: string) => latest.current.onBranchFromMessage(messageId),
    onForkFromMessage: (messageId: string) => latest.current.onForkFromMessage(messageId),
    onViewTurnDiff: (messageId: string, filePath?: string) =>
      latest.current.onViewTurnDiff(messageId, filePath),
    onToggleTurnFold: (turnKey: string) => latest.current.onToggleTurnFold(turnKey),
    onOpenSettings: () => latest.current.onOpenSettings(),
    onRetry: (content: string) => {
      void latest.current.onRetryText(content)
    },
    onDismissError: (message: string) => latest.current.onDismissError(message),
  }))
  const turnAnchorMessageIds = useContentStable(section.turnAnchorMessageIds, sameSet)
  const turnsByAnchorNodeId = useContentStable(section.turnsByAnchorNodeId, sameTurns)
  const projectPaths = useContentStable(section.extensionProjectPaths, sameList)
  const sessionId = section.activeSessionId
  const registry = section.extensionRegistry

  const [context, setContext] = useState<ChatRowRenderContext | null>(null)
  const current =
    context &&
    context.runtime.sessionId === sessionId &&
    context.extensions.registry === registry &&
    context.extensions.projectPaths === projectPaths &&
    context.turnsByAnchorNodeId === turnsByAnchorNodeId &&
    context.actions.turnAnchorMessageIds === turnAnchorMessageIds
      ? context
      : null
  if (current) return current

  const extensions = { registry, projectPaths }
  const next: ChatRowRenderContext = {
    runtime: { sessionId, extensions },
    extensions,
    turnsByAnchorNodeId,
    actions: {
      onDismissInterruptedRun: callbacks.onDismissInterruptedRun,
      onBranchFromMessage: callbacks.onBranchFromMessage,
      onForkFromMessage: callbacks.onForkFromMessage,
      onViewTurnDiff: callbacks.onViewTurnDiff,
      turnAnchorMessageIds,
      onToggleTurnFold: callbacks.onToggleTurnFold,
      onOpenTurnDiff: callbacks.onViewTurnDiff,
    },
    onOpenSettings: callbacks.onOpenSettings,
    onRetry: callbacks.onRetry,
    onDismissError: callbacks.onDismissError,
  }
  setContext(next)
  return next
}
