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

/** Live reads and moves for leaving a session that was archived or deleted while open. */
export interface SidebarRemovalNavigation {
  /** The live active session, read when an asynchronous mutation settles. */
  readonly getActiveSessionId: () => SessionId | null
  /** Whether a new-session draft is open, which the user chose after starting the removal. */
  readonly hasDraftSession: () => boolean
  /** Sessions in the order the sidebar renders them, read at action time. */
  readonly getVisibleSessionIds: () => readonly SessionId[]
  /** Whether a session is still listed (not archived or deleted meanwhile), read at settle time. */
  readonly isSessionListed: (sessionId: SessionId) => boolean
  readonly selectSession: (sessionId: SessionId) => void
  /** Leave every session without creating a new draft session. */
  readonly clearActiveSession: () => void
}

interface SidebarSessionActionDeps {
  readonly activeSessionId: SessionId | null
  readonly removalNavigation: SidebarRemovalNavigation
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

/**
 * The row a reader lands on when the one they are viewing leaves the list: the nearest still-listed
 * row after it, else before it. The order is captured when the removal starts; which rows are still
 * listed is read when it settles, because neighbours can be archived or deleted meanwhile.
 */
export function adjacentSessionId(
  visibleSessionIds: readonly SessionId[],
  removedSessionId: SessionId,
  isListed: (sessionId: SessionId) => boolean = () => true,
): SessionId | null {
  const index = visibleSessionIds.findIndex((id) => String(id) === String(removedSessionId))
  const candidate = (id: SessionId | undefined) =>
    id !== undefined && String(id) !== String(removedSessionId) && isListed(id)
  if (index === -1) return visibleSessionIds.find(candidate) ?? null
  const after = visibleSessionIds.slice(index + 1).find(candidate)
  if (after) return after
  return [...visibleSessionIds.slice(0, index)].reverse().find(candidate) ?? null
}

interface RemovalStart {
  readonly order: readonly SessionId[]
  readonly wasActive: boolean
}

/** Captured before the mutation: deletion clears the active session before it resolves. */
function startRemoval(navigation: SidebarRemovalNavigation, sessionId: SessionId): RemovalStart {
  return {
    order: navigation.getVisibleSessionIds(),
    wasActive: String(navigation.getActiveSessionId()) === String(sessionId),
  }
}

/**
 * Archiving or deleting the open session moves the reader to its neighbour in the sidebar. It
 * used to start a new draft session instead, so every archive looked like it had created a
 * session. With no neighbour left, the reader returns to the empty home, still without a draft.
 * If the reader opened something else while the removal ran, they stay there.
 */
function leaveRemovedActiveSession(
  deps: SidebarSessionActionDeps,
  sessionId: SessionId,
  start: RemovalStart,
) {
  const navigation = deps.removalNavigation
  if (!start.wasActive) return
  const active = navigation.getActiveSessionId()
  if (active !== null && String(active) !== String(sessionId)) return
  if (active === null && navigation.hasDraftSession()) return
  const neighbour = adjacentSessionId(start.order, sessionId, navigation.isSessionListed)
  if (neighbour) {
    navigation.selectSession(neighbour)
    return
  }
  deps.clearTransientDraftContext()
  navigation.clearActiveSession()
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
      const start = startRemoval(deps.removalNavigation, sessionId)
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
        leaveRemovedActiveSession(deps, sessionId, start)
      })().catch((error: unknown) => {
        deps.showToast(`Failed to archive session: ${errorMessage(error)}`)
      })
    },
    clone(sessionId: SessionId) {
      cloneSession(deps, sessionId)
    },
    delete(sessionId: SessionId) {
      const start = startRemoval(deps.removalNavigation, sessionId)
      void deps
        .deleteSession(sessionId)
        .then(() => leaveRemovedActiveSession(deps, sessionId, start))
        .catch((error: unknown) => {
          deps.showToast(`Failed to delete session: ${errorMessage(error)}`)
        })
    },
    select(id: SessionId) {
      deps.removalNavigation.selectSession(id)
    },
    togglePin(id: SessionId) {
      deps.togglePin(id)
    },
  }
}
