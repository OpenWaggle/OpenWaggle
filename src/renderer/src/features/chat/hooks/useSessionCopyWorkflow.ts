import type { SessionId, SessionNodeId, SupportedModelId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SessionWorkspace } from '@shared/types/session'
import type { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useChatStore } from '@/features/chat/state'
import { buildPendingSessionDraftContextKey } from '@/features/composer/lib'
import { useComposerStore } from '@/features/composer/state'
import { api } from '@/shared/lib/ipc'
import { sessionOperationFailureMessage } from '@/shared/lib/session-operation-failure'
import { setComposerTextValue } from '../lib/composer-text'
import { resolveCurrentConversationNode } from '../lib/current-conversation-node'
import { runSessionCopyOnce } from '../lib/session-copy-in-flight'
import {
  currentForkTargets,
  findForkSourceNodeId,
  findReplyNodeId,
} from '../lib/session-copy-sources'
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

const SOURCE_NOT_LOADED =
  'Fork source is not available yet. Wait for the transcript to finish loading and try again.'

const COPY_WORDS = {
  fork: {
    needsModel: 'Select a model before forking.',
    cancelled: 'Session fork cancelled.',
    noSession: 'Session fork did not return a session.',
    failed: 'Failed to fork session',
  },
  clone: {
    needsModel: 'Select a model before cloning.',
    cancelled: 'Session clone cancelled.',
    noSession: 'Session clone did not return a session.',
    failed: 'Failed to clone session',
  },
} as const

interface SessionCopyRequest {
  /** What the user asked for, which names it in every message. */
  readonly copy: keyof typeof COPY_WORDS
  /** `before`: a new Session up to the node's parent, the node's text drafted; `at`: through it. */
  readonly position: 'before' | 'at'
  /** The source node, which may be read from the Host; null when it is not available. */
  readonly resolveNode: (sessionId: SessionId) => Promise<SessionNodeId | null>
  readonly missingNode: string
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

function copyToNewSession(
  sessionId: SessionId,
  model: SupportedModelId,
  request: SessionCopyRequest,
  nodeId: SessionNodeId,
) {
  return request.position === 'before'
    ? api.forkSessionToNew(sessionId, model, nodeId)
    : api.cloneSessionToNew(sessionId, model, nodeId)
}

/**
 * One copy of the Session shown, from finding its source node to opening the new Session. A
 * second request for the same Session while one is on its way is dropped (`runSessionCopyOnce`).
 * The Host builds the copy's runtime from the source Session's own model; the model named here is
 * only validated, so a Session whose model cannot run now can still be copied.
 */
async function copySessionAction(params: SessionCopyWorkflowParams, request: SessionCopyRequest) {
  const words = COPY_WORDS[request.copy]
  const sessionId = params.activeSessionId
  const model = params.model
  if (!sessionId) return
  if (!model) {
    params.showToast(words.needsModel)
    return
  }
  await runSessionCopyOnce(sessionId, async () => {
    try {
      const nodeId = await request.resolveNode(sessionId)
      // The source may have been re-read from the Host; do not copy a Session the user has left.
      if (useChatStore.getState().activeSessionId !== sessionId) return
      if (!nodeId) {
        params.showToast(request.missingNode)
        return
      }
      const result = await copyToNewSession(sessionId, model, request, nodeId)
      if (result.cancelled) {
        params.showToast(words.cancelled)
        return
      }
      if (!result.session) {
        params.showToast(words.noSession)
        return
      }
      useChatStore.getState().upsertSession(result.session)
      await activateCopiedSession(params, result.session.id, result.editorText ?? '')
    } catch (error) {
      params.showToast(sessionOperationFailureMessage(words.failed, error))
    }
  })
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
      if (!params.activeSessionId) {
        params.showToast('No active session to clone.')
        return Promise.resolve()
      }
      return copySessionAction(params, {
        copy: 'clone',
        position: 'at',
        resolveNode: async (sessionId) =>
          params.draftBranchSourceNodeId ??
          (await resolveCurrentConversationNode(sessionId, params.activeWorkspace)),
        missingNode: 'No session history to clone.',
      })
    },
    /** Fork from here: a new Session before the user message, its text drafted. */
    forkMessageToNewSession(messageId: string) {
      return copySessionAction(params, {
        copy: 'fork',
        position: 'before',
        resolveNode: (sessionId) => findForkSourceNodeId(params, sessionId, messageId),
        missingNode: SOURCE_NOT_LOADED,
      })
    },
    /** Fork from this response: a new Session through the turn's reply, as a clone at its node. */
    forkResponseToNewSession(messageId: string) {
      return copySessionAction(params, {
        copy: 'fork',
        position: 'at',
        resolveNode: (sessionId) => findReplyNodeId(params, sessionId, messageId),
        missingNode: SOURCE_NOT_LOADED,
      })
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
    selectForkTarget(target: SessionForkTarget) {
      setForkSelectorOpen(false)
      void copySessionAction(params, {
        copy: 'fork',
        position: 'before',
        resolveNode: async () => target.entryId,
        missingNode: SOURCE_NOT_LOADED,
      })
    },
  }
}
