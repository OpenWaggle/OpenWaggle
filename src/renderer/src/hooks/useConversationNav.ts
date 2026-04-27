import type { ConversationId } from '@shared/types/brand'
import { useSessionStatusStore } from '@/stores/session-status-store'

interface ConversationNavItem {
  readonly id: ConversationId
  readonly projectPath: string | null
}

interface ConversationNavDeps {
  readonly conversations: readonly ConversationNavItem[]
  readonly projectPath: string | null
  readonly setActiveView: (view: 'chat' | 'skills') => void
  readonly setProjectPath: (path: string | null) => Promise<void>
  readonly selectFolder: () => Promise<string | null>
  readonly startDraftSession: () => void
  readonly setActiveConversation: (id: ConversationId | null) => void
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
    projectPath,
    setActiveView,
    setProjectPath,
    selectFolder,
    startDraftSession,
    setActiveConversation,
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
    setActiveConversation(id)
    useSessionStatusStore.getState().markVisited(id)
    if (conv && conv.projectPath !== projectPath) {
      await setProjectPath(conv.projectPath)
    }
    refreshGit(nextProjectPath)
  }

  function handleNewConversation(): void {
    setActiveView('chat')
    startDraftSession()
  }

  async function handleOpenProject(): Promise<void> {
    setActiveView('chat')
    const path = await selectFolder()
    if (!path) return
    await setProjectPath(path)
    startDraftSession()
    refreshGit(path)
  }

  async function handleSelectProjectPath(path: string): Promise<void> {
    setActiveView('chat')
    await setProjectPath(path)
    startDraftSession()
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
