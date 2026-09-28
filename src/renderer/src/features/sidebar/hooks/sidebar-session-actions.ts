import type { SupportedModelId } from '@shared/types/brand'
import { type SessionId, SessionNodeId } from '@shared/types/brand'
import type { SessionTree, SessionWorkspace } from '@shared/types/session'
import type { QueryClient } from '@tanstack/react-query'
import type { useNavigate } from '@tanstack/react-router'
import { useChatStore } from '@/features/chat/state'
import { buildComposerDraftContextKey } from '@/features/composer/lib'
import { useComposerStore } from '@/features/composer/state'
import { isModelActionable } from '@/features/providers/state'
import { usePreferencesStore } from '@/features/settings/state'
import { refreshArchivedSessions } from '@/queries/archived-sessions'
import { refreshAfterCommittedSessionMutation } from '@/queries/committed-session-refresh'
import { api } from '@/shared/lib/ipc'
import { archiveWorkspaceOwner } from '@/shell/workspace-panel-cleanup'
import { clearComposerDraftForSession, errorMessage } from './sidebar-action-utils'

type Navigate = ReturnType<typeof useNavigate>

interface SidebarSessionActionDeps {
  readonly activeSessionId: SessionId | null
  /** The live active session, read when an asynchronous mutation settles. */
  readonly getActiveSessionId: () => SessionId | null
  /** Sessions in the order the sidebar renders them, read at action time. */
  readonly getVisibleSessionIds: () => readonly SessionId[]
  readonly selectSession: (sessionId: SessionId) => void
  /** Leave every session without creating a new draft session. */
  readonly clearActiveSession: () => void
  readonly matchingActiveSessionTree: SessionTree | null
  readonly matchingActiveWorkspace: SessionWorkspace | null
  readonly navigate: Navigate
  readonly projectPath: string | null
  readonly queryClient: QueryClient
  readonly selectedModel: SupportedModelId | undefined
  readonly showToast: (message: string) => void
  readonly clearTransientDraftContext: () => void
  readonly deleteSession: (sessionId: SessionId) => Promise<void>
  readonly loadChatSessions: () => Promise<void>
  readonly loadSessionTrees: () => Promise<void>
  readonly refreshSessionWorkspace: (sessionId: SessionId | null) => Promise<void>
  /** Pin or unpin the session, resolved against the current Pinned sessions. */
  readonly togglePin: (sessionId: SessionId) => void
}

/** The row a reader lands on when the one they are viewing leaves the list: the next, else the previous. */
export function adjacentSessionId(
  visibleSessionIds: readonly SessionId[],
  removedSessionId: SessionId,
): SessionId | null {
  const index = visibleSessionIds.findIndex((id) => String(id) === String(removedSessionId))
  if (index === -1) return visibleSessionIds[0] ?? null
  return visibleSessionIds[index + 1] ?? visibleSessionIds[index - 1] ?? null
}

/**
 * Archiving or deleting the open session moves the reader to its neighbour in the sidebar. It
 * used to start a new draft session instead, so every archive looked like it had created a
 * session. With no neighbour left, the reader returns to the empty home, still without a draft.
 */
function leaveRemovedActiveSession(
  deps: SidebarSessionActionDeps,
  sessionId: SessionId,
  neighbour: SessionId | null,
) {
  if (String(deps.getActiveSessionId()) !== String(sessionId)) return
  if (neighbour) {
    deps.selectSession(neighbour)
    return
  }
  deps.clearTransientDraftContext()
  deps.clearActiveSession()
  void deps.navigate({ to: '/' })
}

function setComposerTextValue(text: string) {
  const composer = useComposerStore.getState()
  composer.setInput(text)
  composer.setCursorIndex(text.length)
  const editor = composer.lexicalEditor
  if (!editor) return
  void import('@/features/composer/lib').then(({ setEditorText }) => {
    const current = useComposerStore.getState()
    if (current.lexicalEditor === editor && current.input === text) {
      setEditorText(editor, text)
    }
  })
}

function activateClonedSession(
  deps: SidebarSessionActionDeps,
  sessionId: SessionId,
  project: string | null,
) {
  const contextKey = buildComposerDraftContextKey({ projectPath: project, sessionId })
  useComposerStore.getState().switchScopedDraftContext(contextKey, { input: '', attachments: [] })
  setComposerTextValue('')
  useChatStore.getState().setActiveSession(sessionId)
  void deps.navigate({ to: '/sessions/$sessionId', params: { sessionId: String(sessionId) } })
}

function cloneSession(deps: SidebarSessionActionDeps, sessionId: SessionId) {
  const targetNodeId =
    deps.matchingActiveWorkspace?.activeNodeId ??
    deps.matchingActiveSessionTree?.session.lastActiveNodeId

  if (deps.activeSessionId !== sessionId) {
    deps.showToast('Open this session before cloning it.')
    return
  }
  if (!targetNodeId) {
    deps.showToast('No session history to clone.')
    return
  }

  if (
    !isModelActionable(usePreferencesStore.getState().settings.enabledModels, deps.selectedModel)
  ) {
    deps.showToast('Select a model before cloning.')
    return
  }

  void api
    .cloneSessionToNew(sessionId, deps.selectedModel, SessionNodeId(String(targetNodeId)))
    .then((result) => {
      if (result.cancelled) {
        deps.showToast('Session clone cancelled.')
        return
      }
      if (!result.session) {
        deps.showToast('Session clone did not return a session.')
        return
      }
      useChatStore.getState().upsertSession(result.session)
      activateClonedSession(deps, result.session.id, result.session.projectPath)
      return Promise.all([
        deps.loadChatSessions(),
        deps.loadSessionTrees(),
        deps.refreshSessionWorkspace(result.session.id),
      ])
    })
    .catch((error: unknown) => {
      deps.showToast(`Failed to clone session: ${errorMessage(error)}`)
    })
}

export function createSidebarSessionActions(deps: SidebarSessionActionDeps) {
  return {
    archive(sessionId: SessionId) {
      // Archiving is reversible from the archived list, so it does not ask first; only deletion does.
      const neighbour = adjacentSessionId(deps.getVisibleSessionIds(), sessionId)
      void (async () => {
        await api.archiveSession(sessionId)
        await refreshAfterCommittedSessionMutation(
          async () => {
            await archiveWorkspaceOwner(String(sessionId))
            clearComposerDraftForSession(sessionId)
          },
          () =>
            Promise.all([
              deps.loadChatSessions(),
              deps.loadSessionTrees(),
              refreshArchivedSessions(deps.queryClient),
            ]),
        )
        leaveRemovedActiveSession(deps, sessionId, neighbour)
      })().catch((error: unknown) => {
        deps.showToast(`Failed to archive session: ${errorMessage(error)}`)
      })
    },
    clone(sessionId: SessionId) {
      cloneSession(deps, sessionId)
    },
    delete(sessionId: SessionId) {
      const neighbour = adjacentSessionId(deps.getVisibleSessionIds(), sessionId)
      void deps
        .deleteSession(sessionId)
        .then(() => leaveRemovedActiveSession(deps, sessionId, neighbour))
        .catch((error: unknown) => {
          deps.showToast(`Failed to delete session: ${errorMessage(error)}`)
        })
    },
    select(id: SessionId) {
      deps.selectSession(id)
    },
    togglePin(id: SessionId) {
      deps.togglePin(id)
    },
  }
}
