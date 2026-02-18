import { useCallback, useEffect, useRef, useState } from 'react'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { Composer } from '@/components/composer/Composer'
import { StatusBar } from '@/components/composer/StatusBar'
import { Header } from '@/components/layout/Header'
import { Sidebar } from '@/components/layout/Sidebar'
import { SettingsDialog } from '@/components/settings/SettingsDialog'
import { TerminalPanel } from '@/components/terminal/TerminalPanel'
import { useAgentChat } from '@/hooks/useAgentChat'
import { useChat } from '@/hooks/useChat'
import { useProject } from '@/hooks/useProject'
import { useSettings, useSettingsSetup } from '@/hooks/useSettings'
import { cn } from '@/lib/cn'
import { useChatStore } from '@/stores/chat-store'

export function App(): React.JSX.Element {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [terminalOpen, setTerminalOpen] = useState(false)

  useSettingsSetup()

  const { settings, isLoaded, providerModels, setDefaultModel } = useSettings()
  const { projectPath } = useProject()
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

  const currentModel = settings.defaultModel

  const conversation = useChatStore((s) => s.activeConversation)
  const { messages, sendMessage, isLoading, stop, error } = useAgentChat(
    activeConversationId,
    conversation,
    currentModel,
  )

  const pendingMessage = useRef<string | null>(null)

  useEffect(() => {
    if (activeConversationId && pendingMessage.current) {
      const content = pendingMessage.current
      pendingMessage.current = null
      sendMessage(content)
    }
  }, [activeConversationId, sendMessage])

  const handleNewConversation = useCallback(async () => {
    await createConversation(currentModel, projectPath)
  }, [createConversation, currentModel, projectPath])

  const handleModelChange = useCallback(
    (model: typeof currentModel) => {
      setDefaultModel(model)
    },
    [setDefaultModel],
  )

  const handleSend = useCallback(
    async (content: string) => {
      if (!activeConversationId) {
        pendingMessage.current = content
        await createConversation(currentModel, projectPath)
        return
      }
      await sendMessage(content)
    },
    [activeConversationId, createConversation, currentModel, projectPath, sendMessage],
  )

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
        e.preventDefault()
        setTerminalOpen((prev) => !prev)
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault()
        handleNewConversation()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault()
        setSidebarOpen((prev) => !prev)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleNewConversation])

  if (!isLoaded) {
    return (
      <div className="flex h-full items-center justify-center bg-bg">
        <div className="text-text-tertiary text-sm">Loading...</div>
      </div>
    )
  }

  return (
    <div className="h-full w-full bg-transparent p-2">
      <div className="flex h-full overflow-hidden rounded-[16px] border border-border/95 bg-bg shadow-[0_20px_56px_rgba(0,0,0,0.45)]">
        {/* Sidebar with slide transition */}
        <div
          className={cn(
            'shrink-0 overflow-hidden transition-[width] duration-200 ease-out',
            sidebarOpen ? 'w-[252px]' : 'w-0',
          )}
        >
          <Sidebar
            conversations={conversations}
            activeId={activeConversationId}
            onSelect={setActiveConversation}
            onDelete={deleteConversation}
            onNew={handleNewConversation}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        </div>

        {/* Main panel */}
        <div className="flex flex-1 flex-col overflow-hidden bg-bg/85">
          <Header
            conversationTitle={activeConversation?.title ?? null}
            projectPath={projectPath}
            onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
            sidebarOpen={sidebarOpen}
          />

          {/* Thread content area */}
          <div className="flex flex-1 overflow-hidden">
            <main className="flex-1 overflow-hidden">
              <ChatPanel
                messages={messages}
                isLoading={isLoading}
                error={error}
                projectPath={projectPath}
                hasProject={!!projectPath}
                onOpenSettings={() => setSettingsOpen(true)}
                onRetry={handleSend}
              />
            </main>
          </div>

          {/* Composer */}
          <Composer
            onSend={handleSend}
            onCancel={stop}
            isLoading={isLoading}
            model={currentModel}
            onModelChange={handleModelChange}
            settings={settings}
            providerModels={providerModels}
          />

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

          {/* Status bar */}
          <StatusBar projectPath={projectPath} />
        </div>

        <SettingsDialog isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </div>
    </div>
  )
}
