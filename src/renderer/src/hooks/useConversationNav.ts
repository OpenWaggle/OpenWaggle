import type { ConversationId } from '@shared/types/brand'
import type { ConversationSummary } from '@shared/types/conversation'
import { useThreadStatusStore } from '@/stores/thread-status-store'

interface ConversationNavDeps {
  readonly conversations: readonly ConversationSummary[]
  readonly activeConversationId: ConversationId | null
  readonly projectPath: string | null
  readonly setActiveView: (view: 'chat' | 'skills') => void
  readonly setProjectPath: (path: string | null) => Promise<void>
  readonly selectFolder: () => Promise<string | null>
  readonly createConversation: (projectPath: string | null) => Promise<ConversationId>
  readonly startDraftThread: () => void
  readonly setActiveConversation: (id: ConversationId | null) => void
  readonly updateConversationProjectPath: (id: ConversationId, path: string | null) => Promise<void>
  readonly refreshGitStatus: (projectPath: string | null) => Promise<void>
  readonly refreshGitBranches: (projectPath: string | null) => Promise<void>
}

interface ConversationNavHandlers {
  readonly handleSelectConversation: (id: ConversationId) => Promise<void>
  readonly handleNewConversation: () => void
  readonly handleOpenProject: () => Promise<void>
  readonly handleSelectProjectPath: (path: string) => Promise<void>
}

/** Pure factory — testable without React. */
export function createConversationNavHandlers(deps: ConversationNavDeps): ConversationNavHandlers {
  const {
    conversations,
    activeConversationId,
    projectPath,
    setActiveView,
    setProjectPath,
    selectFolder,
    createConversation,
    startDraftThread,
    setActiveConversation,
    updateConversationProjectPath,
    refreshGitStatus,
    refreshGitBranches,
  } = deps

  function refreshGit(path: string | null): void {
    void Promise.all([refreshGitStatus(path), refreshGitBranches(path)])
  }

  async function handleSelectConversation(id: ConversationId): Promise<void> {
    setActiveView('chat')
    const conv = conversations.find((c) => c.id === id)
    const nextProjectPath = conv?.projectPath ?? projectPath
    if (conv && conv.projectPath !== projectPath) {
      await setProjectPath(conv.projectPath)
    }
    setActiveConversation(id)
    useThreadStatusStore.getState().markVisited(id)
    refreshGit(nextProjectPath)
  }

  function handleNewConversation(): void {
    setActiveView('chat')
    startDraftThread()
  }

  async function handleOpenProject(): Promise<void> {
    setActiveView('chat')
    const path = await selectFolder()
    if (!path) return
    if (activeConversationId) {
      await updateConversationProjectPath(activeConversationId, path)
      await setProjectPath(path)
      setActiveConversation(activeConversationId)
    } else {
      await setProjectPath(path)
      await createConversation(path)
    }
    refreshGit(path)
  }

  async function handleSelectProjectPath(path: string): Promise<void> {
    setActiveView('chat')
    if (activeConversationId) {
      await updateConversationProjectPath(activeConversationId, path)
      await setProjectPath(path)
      setActiveConversation(activeConversationId)
      refreshGit(path)
      return
    }
    await setProjectPath(path)
    await createConversation(path)
    refreshGit(path)
  }

  return {
    handleSelectConversation,
    handleNewConversation,
    handleOpenProject,
    handleSelectProjectPath,
  }
}

/** Hook wrapper — calls the factory with current deps. */
export function useConversationNav(deps: ConversationNavDeps): ConversationNavHandlers {
  return createConversationNavHandlers(deps)
}
