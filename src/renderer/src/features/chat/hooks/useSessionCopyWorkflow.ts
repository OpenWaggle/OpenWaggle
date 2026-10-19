import { type SessionId, SessionNodeId, type SupportedModelId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SessionWorkspace } from '@shared/types/session'
import type { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useChatStore } from '@/features/chat/state'
import { buildPendingSessionDraftContextKey } from '@/features/composer/lib'
import { useComposerStore } from '@/features/composer/state'
import { api } from '@/shared/lib/ipc'
import { sessionOperationFailureMessage } from '@/shared/lib/session-operation-failure'
import { findAssistantMessageNode, findUserMessageNode } from '../lib/branch-from-message'
import { setComposerTextValue } from '../lib/composer-text'
import {
  currentConversationWorkspace,
  resolveCurrentConversationNode,
} from '../lib/current-conversation-node'
import { runSessionCopyOnce } from '../lib/session-copy-in-flight'
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
  const sessionId = params.activeSessionId
  const model = params.model
  if (!sessionId) return
  // A copy runs no model: the Host copies the transcript as it is. The model only has to be named.
  if (!model) {
    params.showToast('Select a model before forking.')
    return
  }

  await runSessionCopyOnce(sessionId, async () => {
    try {
      const result = await api.forkSessionToNew(sessionId, model, nodeId)
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
      params.showToast(sessionOperationFailureMessage('Failed to fork session', error))
    }
  })
}

async function cloneCurrentSessionToNewSessionAction(params: SessionCopyWorkflowParams) {
  if (!params.activeSessionId) {
    params.showToast('No active session to clone.')
    return
  }

  const model = params.model
  if (!model) {
    params.showToast('Select a model before cloning.')
    return
  }

  const sessionId = params.activeSessionId
  await runSessionCopyOnce(sessionId, () => cloneSessionAt(params, sessionId, model))
}

async function cloneSessionAt(
  params: SessionCopyWorkflowParams,
  sessionId: SessionId,
  model: SupportedModelId,
) {
  try {
    const targetNodeId =
      params.draftBranchSourceNodeId ??
      (await resolveCurrentConversationNode(sessionId, params.activeWorkspace))
    // The head may have been re-read from the Host; do not clone a Session the user has left.
    if (useChatStore.getState().activeSessionId !== sessionId) return
    if (!targetNodeId) {
      params.showToast('No session history to clone.')
      return
    }
    await copyThroughNode(params, sessionId, model, SessionNodeId(String(targetNodeId)))
  } catch (error) {
    params.showToast(sessionOperationFailureMessage('Failed to clone session', error))
  }
}

/** A new Session holding the conversation up to and including `nodeId`, with an empty draft. */
async function copyThroughNode(
  params: SessionCopyWorkflowParams,
  sessionId: SessionId,
  model: SupportedModelId,
  nodeId: SessionNodeId,
) {
  const result = await api.cloneSessionToNew(sessionId, model, nodeId)
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
}

/**
 * Fork from a turn's reply: a new Session with the conversation through that reply. It is a copy
 * at the reply's node, as a clone is at the head.
 */
async function forkResponseToNewSessionAction(
  params: SessionCopyWorkflowParams,
  messageId: string,
) {
  const sessionId = params.activeSessionId
  const model = params.model
  if (!sessionId) return
  if (!model) {
    params.showToast('Select a model before forking.')
    return
  }
  await runSessionCopyOnce(sessionId, async () => {
    try {
      const node = await findReplyNode(params, sessionId, messageId)
      if (useChatStore.getState().activeSessionId !== sessionId) return
      if (!node) {
        params.showToast(
          'Fork source is not available yet. Wait for the transcript to finish loading and try again.',
        )
        return
      }
      await copyThroughNode(params, sessionId, model, node.id)
    } catch (error) {
      params.showToast(sessionOperationFailureMessage('Failed to fork session', error))
    }
  })
}

/**
 * The persisted node of the message to fork. A message sent since the workspace was loaded is not
 * in it yet (runs refresh only the Session detail), so the current workspace is read for it.
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
  const current = await currentConversationWorkspace(sessionId, loaded, { keepEarlierNode: false })
  return findUserMessageNode({ messages: params.messages, workspace: current, messageId })
}

/** The persisted node of a turn's reply, read from the Host when the loaded workspace lacks it. */
async function findReplyNode(
  params: SessionCopyWorkflowParams,
  sessionId: SessionId,
  messageId: string,
) {
  const loaded =
    params.activeWorkspace?.tree.session.id === sessionId ? params.activeWorkspace : null
  const node = findAssistantMessageNode({ messages: params.messages, workspace: loaded, messageId })
  if (node) return node
  const current = await currentConversationWorkspace(sessionId, loaded, { keepEarlierNode: false })
  return findAssistantMessageNode({ messages: params.messages, workspace: current, messageId })
}

/** Fork targets from the current workspace, which includes messages sent since the last load. */
async function currentForkTargets(params: SessionCopyWorkflowParams, sessionId: SessionId) {
  return getVisibleForkTargets(
    await currentConversationWorkspace(sessionId, params.activeWorkspace),
  )
}

export function useSessionCopyWorkflow(params: SessionCopyWorkflowParams) {
  const [forkSelectorOpen, setForkSelectorOpen] = useState(false)
  const [currentTargets, setCurrentTargets] = useState<{
    readonly sessionId: SessionId
    readonly targets: readonly SessionForkTarget[]
  } | null>(null)
  const forkTargets =
    currentTargets && currentTargets.sessionId === params.activeSessionId
      ? currentTargets.targets
      : getVisibleForkTargets(params.activeWorkspace)

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
      const sessionId = params.activeSessionId
      if (!sessionId) return
      try {
        const node = await findForkSourceNode(params, sessionId, messageId)
        // The source may have been re-read from the Host; do not fork a Session the user has left.
        if (useChatStore.getState().activeSessionId !== sessionId) return
        if (!node) {
          params.showToast(
            'Fork source is not available yet. Wait for the transcript to finish loading and try again.',
          )
          return
        }
        await forkNodeToNewSessionAction(params, node.id)
      } catch (error) {
        params.showToast(sessionOperationFailureMessage('Failed to fork session', error))
      }
    },
    openForkSelector() {
      const sessionId = params.activeSessionId
      if (!sessionId) {
        params.showToast('No user messages are available to fork.')
        return
      }
      void currentForkTargets(params, sessionId).then((targets) => {
        if (useChatStore.getState().activeSessionId !== sessionId) return
        if (targets.length === 0) {
          params.showToast('No user messages are available to fork.')
          return
        }
        setCurrentTargets({ sessionId, targets })
        setForkSelectorOpen(true)
      })
    },
    forkResponseToNewSession(messageId: string) {
      return forkResponseToNewSessionAction(params, messageId)
    },
    selectForkTarget(target: SessionForkTarget) {
      setForkSelectorOpen(false)
      void forkNodeToNewSessionAction(params, target.entryId)
    },
  }
}
