import type { SupportedModelId } from '@shared/types/brand'
import { type SessionId, SessionNodeId } from '@shared/types/brand'
import type { SessionTree, SessionWorkspace } from '@shared/types/session'
import type { useNavigate } from '@tanstack/react-router'
import { useChatStore } from '@/features/chat/state'
import { buildComposerDraftContextKey, setEditorText } from '@/features/composer/lib'
import { useComposerStore } from '@/features/composer/state'
import { api } from '@/shared/lib/ipc'
import { clearComposerDraftForSession, errorMessage } from './sidebar-action-utils'

type Navigate = ReturnType<typeof useNavigate>

interface SidebarSessionActionDeps {
  readonly activeSessionId: SessionId | null
  readonly matchingActiveSessionTree: SessionTree | null
  readonly matchingActiveWorkspace: SessionWorkspace | null
  readonly navigate: Navigate
  readonly projectPath: string | null
  readonly selectedModel: SupportedModelId
  readonly showToast: (message: string) => void
  readonly startDraftSession: (projectPath: string | null) => void
  readonly clearTransientDraftContext: () => void
  readonly deleteSession: (sessionId: SessionId) => Promise<void>
  readonly loadChatSessions: () => Promise<void>
  readonly loadSessionTrees: () => Promise<void>
  readonly refreshSessionWorkspace: (sessionId: SessionId | null) => Promise<void>
}

function navigateHomeAfterActiveSessionChange(
  deps: SidebarSessionActionDeps,
  sessionId: SessionId,
) {
  if (deps.activeSessionId !== sessionId) return
  deps.startDraftSession(deps.projectPath)
  void deps.navigate({ to: '/' })
}

function setComposerTextValue(text: string) {
  const composer = useComposerStore.getState()
  composer.setInput(text)
  composer.setCursorIndex(text.length)
  if (composer.lexicalEditor) setEditorText(composer.lexicalEditor, text)
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
      void (async () => {
        const confirmed = await api.showConfirm(
          'Archive this session?',
          'Archiving hides the full session and all branches from normal navigation.',
        )
        if (!confirmed) return
        await api.archiveSession(sessionId)
        clearComposerDraftForSession(sessionId)
        await Promise.all([deps.loadChatSessions(), deps.loadSessionTrees()])
        navigateHomeAfterActiveSessionChange(deps, sessionId)
      })().catch((error: unknown) => {
        deps.showToast(`Failed to archive session: ${errorMessage(error)}`)
      })
    },
    clone(sessionId: SessionId) {
      cloneSession(deps, sessionId)
    },
    delete(sessionId: SessionId) {
      void deps
        .deleteSession(sessionId)
        .then(() => navigateHomeAfterActiveSessionChange(deps, sessionId))
        .catch((error: unknown) => {
          deps.showToast(`Failed to delete session: ${errorMessage(error)}`)
        })
    },
    select(id: SessionId) {
      deps.clearTransientDraftContext()
      useChatStore.getState().setActiveSession(id)
      void deps.navigate({ to: '/sessions/$sessionId', params: { sessionId: String(id) } })
    },
  }
}
