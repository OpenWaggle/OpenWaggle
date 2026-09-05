import type { SessionId } from '@shared/types/brand'
import type { ContextUsageSnapshot } from '@shared/types/context-usage'
import type { SupportedModelId } from '@shared/types/llm'
import { useEffect, useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('context-meter')
const PERCENT_MULTIPLIER = 100

interface ContextUsageRequestState {
  readonly key: string
  readonly snapshot: ContextUsageSnapshot | null
  readonly failed: boolean
}

interface UseContextUsageSnapshotInput {
  readonly activeSessionId: SessionId | null
  readonly selectedModel: SupportedModelId
  readonly requestKey: string
}

export function useContextUsageSnapshot({
  activeSessionId,
  selectedModel,
  requestKey,
}: UseContextUsageSnapshotInput) {
  const [requestState, setRequestState] = useState<ContextUsageRequestState>({
    key: '',
    snapshot: null,
    failed: false,
  })

  useEffect(() => {
    if (!activeSessionId || typeof api.getContextUsage !== 'function') return

    let cancelled = false
    let receivedLiveUpdate = false
    const currentRequestKey = requestKey

    const unsubscribe =
      typeof api.onAgentEvent === 'function'
        ? api.onAgentEvent((payload) => {
            const event = payload.event
            if (
              cancelled ||
              payload.sessionId !== activeSessionId ||
              event.model !== selectedModel
            ) {
              return
            }

            if (event.type === 'context_usage') {
              receivedLiveUpdate = true
              setRequestState({
                key: currentRequestKey,
                snapshot: {
                  tokens: event.tokens,
                  contextWindow: event.contextWindow,
                  percent: (event.tokens / event.contextWindow) * PERCENT_MULTIPLIER,
                },
                failed: false,
              })
              return
            }

            if (event.type === 'compaction_end' && !event.aborted && !event.errorMessage) {
              receivedLiveUpdate = true
              setRequestState((current) => ({
                key: currentRequestKey,
                snapshot:
                  current.key === currentRequestKey && current.snapshot
                    ? {
                        tokens: null,
                        contextWindow: current.snapshot.contextWindow,
                        percent: null,
                      }
                    : null,
                failed: false,
              }))
            }
          })
        : undefined

    api
      .getContextUsage(activeSessionId, selectedModel)
      .then((snapshot) => {
        if (!cancelled && !receivedLiveUpdate) {
          setRequestState({ key: currentRequestKey, snapshot, failed: false })
        }
      })
      .catch((error: unknown) => {
        if (cancelled || receivedLiveUpdate) return
        logger.warn('Failed to load Pi context usage', {
          error: error instanceof Error ? error.message : String(error),
        })
        setRequestState({ key: currentRequestKey, snapshot: null, failed: true })
      })

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [activeSessionId, selectedModel, requestKey])

  return {
    snapshot: requestState.key === requestKey ? requestState.snapshot : null,
    failed: requestState.key === requestKey && requestState.failed,
  }
}
