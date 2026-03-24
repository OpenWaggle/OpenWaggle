import type { Conversation } from '@shared/types/conversation'
import { isApprovalRequiredToolName } from '@shared/types/tool-approval'
import type { UIMessage } from '@tanstack/ai-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/ipc'
import { createRendererLogger } from '@/lib/logger'
import {
  type ApprovalTrustStatus,
  resolvePendingApprovalForUI,
} from '../pending-approval-visibility'
import { findPendingApproval, type PendingApproval } from '../pending-tool-interactions'

const logger = createRendererLogger('chat-panel')

function getApprovalTrustStatusKey(pendingApproval: PendingApproval): string {
  return `${pendingApproval.approvalId}:${pendingApproval.toolCallId}`
}

function getCurrentTurnMessages(messages: UIMessage[]): UIMessage[] {
  let lastUserIndex = -1

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.role === 'user') {
      lastUserIndex = index
      break
    }
  }

  return messages.slice(lastUserIndex + 1)
}

interface PendingApprovalTrustCheckResult {
  readonly pendingApprovalForUI: PendingApproval | null
  readonly pendingApproval: PendingApproval | null
}

export function usePendingApprovalTrustCheck(
  messages: UIMessage[],
  activeConversation: Conversation | null,
  executionMode: string,
  trustProjectPath: string | null,
  respondToolApproval: (approvalId: string, approved: boolean) => Promise<void>,
): PendingApprovalTrustCheckResult {
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const activeConversationRef = useRef(activeConversation)
  activeConversationRef.current = activeConversation

  const approvalTrustStatusRef = useRef<Record<string, ApprovalTrustStatus>>({})
  const [approvalTrustStatusById, setApprovalTrustStatusById] = useState<
    Record<string, ApprovalTrustStatus>
  >({})

  const setApprovalTrustStatus = useCallback(
    (approvalTrustKey: string, status: ApprovalTrustStatus): void => {
      const nextStatus = {
        ...approvalTrustStatusRef.current,
        [approvalTrustKey]: status,
      } satisfies Record<string, ApprovalTrustStatus>
      approvalTrustStatusRef.current = nextStatus
      setApprovalTrustStatusById(nextStatus)
    },
    [],
  )

  const pendingApproval = findPendingApproval(messages, activeConversation)
  const pendingApprovalTrustableToolName =
    pendingApproval && isApprovalRequiredToolName(pendingApproval.toolName)
      ? pendingApproval.toolName
      : null
  const pendingApprovalHasApprovalMetadata = pendingApproval?.hasApprovalMetadata === true
  const pendingApprovalTrustKey = pendingApproval
    ? getApprovalTrustStatusKey(pendingApproval)
    : null
  const canCheckPendingApprovalTrust = Boolean(
    pendingApproval &&
      executionMode === 'default-permissions' &&
      trustProjectPath &&
      pendingApprovalTrustableToolName &&
      typeof api.isProjectToolCallTrusted === 'function',
  )
  const canAutoApprovePendingTool =
    canCheckPendingApprovalTrust && pendingApprovalHasApprovalMetadata
  const pendingApprovalTrustStatus = pendingApprovalTrustKey
    ? approvalTrustStatusById[pendingApprovalTrustKey]
    : undefined
  const pendingApprovalForUI = resolvePendingApprovalForUI({
    pendingApproval,
    canCheckPendingApprovalTrust,
    pendingApprovalTrustStatus,
  })

  const pendingApprovalKey = pendingApprovalTrustKey
  const pendingApprovalArgs = pendingApproval?.toolArgs
  const pendingApprovalId = pendingApproval?.approvalId

  const pendingApprovalTrustStatusForEffect = useRef(pendingApprovalTrustStatus)
  pendingApprovalTrustStatusForEffect.current = pendingApprovalTrustStatus

  const pendingApprovalIsDuplicateRef = useRef(false)
  pendingApprovalIsDuplicateRef.current = (() => {
    if (!pendingApproval) return false
    const currentTurnMessages = getCurrentTurnMessages(messages)

    for (const msg of currentTurnMessages) {
      for (const part of msg.parts) {
        if (
          part.type === 'tool-call' &&
          part.name === pendingApproval.toolName &&
          part.arguments === pendingApproval.toolArgs &&
          part.id !== pendingApproval.toolCallId
        ) {
          const hasResult = currentTurnMessages.some((m) =>
            m.parts.some((p) => p.type === 'tool-result' && p.toolCallId === part.id),
          )
          if (hasResult) return true
        }
      }
    }
    return false
  })()

  const isPendingApprovalStillCurrent = useCallback((approvalTrustKey: string): boolean => {
    const currentPendingApproval = findPendingApproval(
      messagesRef.current,
      activeConversationRef.current,
    )
    if (!currentPendingApproval) {
      return false
    }
    return getApprovalTrustStatusKey(currentPendingApproval) === approvalTrustKey
  }, [])

  useEffect(() => {
    if (
      !pendingApprovalKey ||
      !pendingApprovalId ||
      !canAutoApprovePendingTool ||
      !trustProjectPath ||
      !pendingApprovalTrustableToolName
    ) {
      return
    }
    if (pendingApprovalTrustStatusForEffect.current !== undefined) {
      return
    }

    let active = true

    if (pendingApprovalIsDuplicateRef.current) {
      void (async () => {
        if (!isPendingApprovalStillCurrent(pendingApprovalKey)) {
          return
        }
        setApprovalTrustStatus(pendingApprovalKey, 'checking')
        try {
          await respondToolApproval(pendingApprovalId, false)
        } catch (err) {
          if (!active) return
          setApprovalTrustStatus(pendingApprovalKey, 'untrusted')
          logger.error('[AUTO-APPROVE] Error auto-skipping duplicate tool call', {
            error: err instanceof Error ? err.message : String(err),
          })
        }
      })()
      return () => {
        active = false
      }
    }

    setApprovalTrustStatus(pendingApprovalKey, 'checking')

    void (async () => {
      try {
        const trusted = await api.isProjectToolCallTrusted(
          trustProjectPath,
          pendingApprovalTrustableToolName,
          pendingApprovalArgs ?? '',
        )
        if (!active || !isPendingApprovalStillCurrent(pendingApprovalKey)) return
        setApprovalTrustStatus(pendingApprovalKey, trusted ? 'trusted' : 'untrusted')
        if (trusted) {
          await respondToolApproval(pendingApprovalId, true)
        }
      } catch (err) {
        logger.error('[AUTO-APPROVE] Error in trust check or approval', {
          error: err instanceof Error ? err.message : String(err),
        })
        if (!active || !isPendingApprovalStillCurrent(pendingApprovalKey)) return
        setApprovalTrustStatus(pendingApprovalKey, 'untrusted')
      }
    })()

    return () => {
      active = false
    }
  }, [
    canAutoApprovePendingTool,
    pendingApprovalKey,
    pendingApprovalId,
    pendingApprovalArgs,
    pendingApprovalTrustableToolName,
    trustProjectPath,
    respondToolApproval,
    setApprovalTrustStatus,
    isPendingApprovalStillCurrent,
  ])

  return { pendingApprovalForUI, pendingApproval }
}
