import type { SupportedModelId } from '@shared/types/llm'
import { useEffect, useRef, useState } from 'react'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { Header } from '@/components/layout/Header'
import { Sidebar } from '@/components/layout/Sidebar'
import { SettingsDialog } from '@/components/settings/SettingsDialog'
import { TerminalPanel } from '@/components/terminal/TerminalPanel'
import { useAgentChat } from '@/hooks/useAgentChat'
import { useChat } from '@/hooks/useChat'
import { useGit } from '@/hooks/useGit'
import { useProject } from '@/hooks/useProject'
import { useSettings, useSettingsSetup } from '@/hooks/useSettings'
import { cn } from '@/lib/cn'
import { api } from '@/lib/ipc'
import { isTerminalChunk } from '@/lib/ipc-connection-adapter'
import { useChatStore } from '@/stores/chat-store'

export function App(): React.JSX.Element {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [terminalOpen, setTerminalOpen] = useState(false)

  useSettingsSetup()

  const { settings, isLoaded, providerModels, setDefaultModel } = useSettings()
  const { projectPath, selectFolder, setProjectPath } = useProject()
  const {
    status: gitStatus,
    isLoading: gitLoading,
    isCommitting: gitCommitting,
    error: gitError,
    refreshStatus: refreshGitStatus,
    commit: commitGit,
  } = useGit()
  const {
    conversations,
    activeConversation,
    activeConversationId,
    createConversation,
    setActiveConversation,
    deleteConversation,
    loadConversations,
  } = useChat()

  useEffect(() => {
    loadConversations()
  }, [loadConversations])

  useEffect(() => {
    void refreshGitStatus(projectPath)
  }, [projectPath, refreshGitStatus])

  const currentModel = settings.defaultModel

  const conversation = useChatStore((s) => s.activeConversation)
  const messageModelLookup: Record<string, SupportedModelId> = {}
  for (const msg of conversation?.messages ?? []) {
    if (msg.role === 'assistant' && msg.model) {
      messageModelLookup[String(msg.id)] = msg.model
    }
  }
  const { messages, sendMessage, isLoading, stop, error, respondToolApproval, answerQuestion } =
    useAgentChat(activeConversationId, conversation, currentModel)

  const pendingMessage = useRef<string | null>(null)

  useEffect(() => {
    if (activeConversationId && pendingMessage.current) {
      const content = pendingMessage.current
      pendingMessage.current = null
      sendMessage(content)
    }
  }, [activeConversationId, sendMessage])

  // Debounced git refresh for stream-chunk events to avoid excessive subprocess spawning
  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null

    const unsubscribe = api.onStreamChunk(({ conversationId, chunk }) => {
      if (!isTerminalChunk(chunk)) return

      void loadConversations()
      if (activeConversationId === conversationId) {
        void setActiveConversation(activeConversationId)
      }
      if (projectPath) {
        if (refreshTimer) clearTimeout(refreshTimer)
        refreshTimer = setTimeout(() => {
          refreshTimer = null
          void refreshGitStatus(projectPath)
        }, 500)
      }
    })

    return () => {
      unsubscribe()
      if (refreshTimer) clearTimeout(refreshTimer)
    }
  }, [
    activeConversationId,
    loadConversations,
    projectPath,
    refreshGitStatus,
    setActiveConversation,
  ])

  async function handleSelectConversation(id: Parameters<typeof setActiveConversation>[0]) {
    const conv = conversations.find((c) => c.id === id)
    const nextProjectPath = conv?.projectPath ?? projectPath
    if (conv && conv.projectPath !== projectPath) {
      await setProjectPath(conv.projectPath)
    }
    await setActiveConversation(id)
    void refreshGitStatus(nextProjectPath)
  }

  async function handleNewConversation() {
    await createConversation(projectPath)
  }

  async function handleOpenProject() {
    const path = await selectFolder()
    if (path) {
      await createConversation(path)
    }
  }

  function handleModelChange(model: typeof currentModel) {
    setDefaultModel(model)
  }

  async function handleSend(content: string) {
    if (!activeConversationId) {
      pendingMessage.current = content
      await createConversation(projectPath)
      return
    }
    await sendMessage(content)
  }

  function handleRefreshGit() {
    void refreshGitStatus(projectPath)
  }

  async function handleCommitGit(message: string, amend: boolean, paths: string[]) {
    if (!projectPath) {
      return {
        ok: false as const,
        code: 'not-git-repo' as const,
        message: 'No project selected.',
      }
    }
    return commitGit(projectPath, { message, amend, paths })
  }

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
        e.preventDefault()
        setTerminalOpen((prev) => !prev)
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault()
        void createConversation(projectPath)
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault()
        setSidebarOpen((prev) => !prev)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [createConversation, projectPath])

  if (!isLoaded) {
    return (
      <div className="flex h-full items-center justify-center bg-bg">
        <div className="text-text-tertiary text-sm">Loading...</div>
      </div>
    )
  }

  return (
    <div className="flex h-full w-full overflow-hidden bg-bg">
      {/* Sidebar with slide transition */}
      <div
        className={cn(
          'shrink-0 overflow-hidden transition-[width] duration-200 ease-out',
          sidebarOpen ? 'w-[272px]' : 'w-0',
        )}
      >
        <Sidebar
          conversations={conversations}
          activeId={activeConversationId}
          onSelect={handleSelectConversation}
          onDelete={deleteConversation}
          onNew={handleNewConversation}
          onOpenProject={handleOpenProject}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      </div>

      {/* Main panel */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header
          conversationTitle={activeConversation?.title ?? null}
          projectPath={projectPath}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          onToggleTerminal={() => setTerminalOpen(!terminalOpen)}
          sidebarOpen={sidebarOpen}
          terminalOpen={terminalOpen}
          gitStatus={gitStatus}
          gitError={gitError}
          gitLoading={gitLoading}
          gitCommitting={gitCommitting}
          onRefreshGit={handleRefreshGit}
          onCommitGit={handleCommitGit}
        />

        {/* Main content — centers the chat panel */}
        <div className="flex flex-1 justify-center overflow-hidden">
          <ChatPanel
            messages={messages}
            isLoading={isLoading}
            error={error}
            projectPath={projectPath}
            hasProject={!!projectPath}
            conversationId={activeConversationId}
            onOpenProject={handleOpenProject}
            onOpenSettings={() => setSettingsOpen(true)}
            onRetry={handleSend}
            onSend={handleSend}
            onCancel={stop}
            onToolApprovalResponse={respondToolApproval}
            onAnswerQuestion={answerQuestion}
            model={currentModel}
            onModelChange={handleModelChange}
            settings={settings}
            providerModels={providerModels}
            messageModelLookup={messageModelLookup}
            gitBranch={gitStatus?.branch ?? null}
            onRefreshGit={handleRefreshGit}
            isRefreshingGit={gitLoading}
          />
        </div>

        {/* Terminal with slide transition */}
        <div
          className={cn(
            'overflow-hidden transition-[height] duration-200 ease-out',
            terminalOpen ? 'h-[228px]' : 'h-0',
          )}
        >
          {terminalOpen && (
            <TerminalPanel projectPath={projectPath} onClose={() => setTerminalOpen(false)} />
          )}
        </div>
      </div>

      <SettingsDialog isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
