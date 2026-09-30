import { type SessionId, SessionNodeId, type SupportedModelId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SessionWorkspace } from '@shared/types/session'
import type { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useChatStore } from '@/features/chat/state'
import { buildPendingSessionDraftContextKey } from '@/features/composer/lib'
import { useComposerStore } from '@/features/composer/state'
import { isSelectableModel, useProviderStore } from '@/features/providers/state'
import { usePreferencesStore } from '@/features/settings/state'
import { api } from '@/shared/lib/ipc'
import { ipcErrorMessage } from '@/shared/lib/ipc-error-message'
import { findUserMessageNode } from '../lib/branch-from-message'
import { setComposerTextValue } from '../lib/composer-text'
import { resolveCurrentConversationNode } from '../lib/current-conversation-node'
import { getVisibleForkTargets, type SessionForkTarget } from '../lib/session-fork-targets'

type Navigate = ReturnType<typeof useNavigate>

interface SessionCopyWorkflowParams {
  readonly activeSessionId: SessionId | null
  readonly activeWorkspace: SessionWorkspace | null
  readonly messages: readonly UIMessage[]
  readonly draftBranchSourceNodeId: SessionNodeId | null
  readonly model: SupportedModelId | undefined
  readonly navigate: Navigate
  readonly setActiveSession: (sessionId: SessionId | null) => void
  readonly loadSessions: () => Promise<void>
  readonly refreshSession: (sessionId: SessionId) => Promise<void>
  readonly refreshSessionWorkspace: (sessionId: SessionId | null) => Promise<void>
  readonly showToast: (message: string) => void
}

function routeToCopiedSession(params: SessionCopyWorkflowParams, sessionId: SessionId) {
  void params.navigate({
    to: '/sessions/$sessionId',
    params: { sessionId: String(sessionId) },
    search: (previous) => ({ ...previous, branch: undefined, node: undefined }),
  })
}

async function activateCopiedSession(
  params: SessionCopyWorkflowParams,
  sessionId: SessionId,
  editorText: string,
) {
  // The copy has no hydrated workspace yet, so its first draft is the Session's pending draft.
  // A branch key written here was never read: the fork's message never reached the composer.
  const appliedDraft = useComposerStore
    .getState()
    .switchScopedDraftContext(buildPendingSessionDraftContextKey(sessionId), {
      input: editorText,
      attachments: [],
    })
  setComposerTextValue(appliedDraft.input)
  params.setActiveSession(sessionId)
  routeToCopiedSession(params, sessionId)
  await Promise.all([
    params.loadSessions(),
    params.refreshSession(sessionId),
    params.refreshSessionWorkspace(sessionId),
  ])
}

async function forkNodeToNewSessionAction(
  params: SessionCopyWorkflowParams,
  nodeId: SessionNodeId,
) {
  if (!params.activeSessionId) return
  if (!isModelActionable(params.model)) {
    params.showToast('Select a model before forking.')
    return
  }

  try {
    const result = await api.forkSessionToNew(params.activeSessionId, params.model, nodeId)
    if (result.cancelled) {
      params.showToast('Session fork cancelled.')
      return
    }
    if (!result.session) {
      params.showToast('Session fork did not return a session.')
      return
    }
    useChatStore.getState().upsertSession(result.session)
    await activateCopiedSession(params, result.session.id, result.editorText ?? '')
  } catch (error) {
    params.showToast(`Failed to fork session: ${ipcErrorMessage(error)}`)
  }
}

async function cloneCurrentSessionToNewSessionAction(params: SessionCopyWorkflowParams) {
  if (!params.activeSessionId) {
    params.showToast('No active session to clone.')
    return
  }

  if (!isModelActionable(params.model)) {
    params.showToast('Select a model before cloning.')
    return
  }

  try {
    const targetNodeId =
      params.draftBranchSourceNodeId ??
      (await resolveCurrentConversationNode(params.activeSessionId, params.activeWorkspace))
    if (!targetNodeId) {
      params.showToast('No session history to clone.')
      return
    }
    const result = await api.cloneSessionToNew(
      params.activeSessionId,
      params.model,
      SessionNodeId(String(targetNodeId)),
    )
    if (result.cancelled) {
      params.showToast('Session clone cancelled.')
      return
    }
    if (!result.session) {
      params.showToast('Session clone did not return a session.')
      return
    }
    useChatStore.getState().upsertSession(result.session)
    await activateCopiedSession(params, result.session.id, '')
  } catch (error) {
    params.showToast(`Failed to clone session: ${ipcErrorMessage(error)}`)
  }
}

/**
 * The persisted node of the message to fork. A message sent since the workspace was loaded is not
 * in it yet (runs refresh only the Session detail), so the Host workspace is read again for it.
 */
async function findForkSourceNode(
  params: SessionCopyWorkflowParams,
  sessionId: SessionId,
  messageId: string,
) {
  const loaded =
    params.activeWorkspace?.tree.session.id === sessionId ? params.activeWorkspace : null
  const node = findUserMessageNode({ messages: params.messages, workspace: loaded, messageId })
  if (node) return node
  const current = await api.getSessionWorkspace(
    sessionId,
    loaded?.activeBranchId ? { branchId: loaded.activeBranchId } : undefined,
  )
  return current?.tree.session.id === sessionId
    ? findUserMessageNode({ messages: params.messages, workspace: current, messageId })
    : null
}

export function useSessionCopyWorkflow(params: SessionCopyWorkflowParams) {
  const [forkSelectorOpen, setForkSelectorOpen] = useState(false)
  const forkTargets = getVisibleForkTargets(params.activeWorkspace)

  return {
    forkSelectorOpen,
    forkTargets,
    closeForkSelector() {
      setForkSelectorOpen(false)
    },
    cloneCurrentSessionToNewSession() {
      return cloneCurrentSessionToNewSessionAction(params)
    },
    async forkMessageToNewSession(messageId: string) {
      if (!params.activeSessionId) return
      try {
        const node = await findForkSourceNode(params, params.activeSessionId, messageId)
        if (!node) {
          params.showToast(
            'Fork source is not available yet. Wait for the transcript to finish loading and try again.',
          )
          return
        }
        await forkNodeToNewSessionAction(params, node.id)
      } catch (error) {
        params.showToast(`Failed to fork session: ${ipcErrorMessage(error)}`)
      }
    },
    openForkSelector() {
      if (forkTargets.length === 0) {
        params.showToast('No user messages are available to fork.')
        return
      }
      setForkSelectorOpen(true)
    },
    selectForkTarget(target: SessionForkTarget) {
      setForkSelectorOpen(false)
      void forkNodeToNewSessionAction(params, target.entryId)
    },
  }
}

/**
 * The copy actions dispatch with the active session's resolved model; like the composer send
 * gate, they must refuse models the picker can no longer offer (disabled, pruned, unavailable).
 */
function isModelActionable(model: SupportedModelId | undefined): model is SupportedModelId {
  const { providerModels, catalogHydrated } = useProviderStore.getState()
  return isSelectableModel(
    providerModels,
    usePreferencesStore.getState().settings,
    model,
    catalogHydrated,
  )
}
