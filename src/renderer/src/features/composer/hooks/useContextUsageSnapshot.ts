import type { SessionId } from '@shared/types/brand'
import type { ContextUsageSnapshot } from '@shared/types/context-usage'
import type { SupportedModelId } from '@shared/types/llm'
import { useEffect, useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('context-meter')

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
    const currentRequestKey = requestKey

    api
      .getContextUsage(activeSessionId, selectedModel)
      .then((snapshot) => {
        if (!cancelled) setRequestState({ key: currentRequestKey, snapshot, failed: false })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        logger.warn('Failed to load Pi context usage', {
          error: error instanceof Error ? error.message : String(error),
        })
        setRequestState({ key: currentRequestKey, snapshot: null, failed: true })
      })

    return () => {
      cancelled = true
    }
  }, [activeSessionId, selectedModel, requestKey])

  return {
    snapshot: requestState.key === requestKey ? requestState.snapshot : null,
    failed: requestState.key === requestKey && requestState.failed,
  }
}
