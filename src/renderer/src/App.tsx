import type { AgentSendPayload } from '@shared/types/agent'
import type { SupportedModelId } from '@shared/types/llm'
import type { OrchestrationEventPayload, OrchestrationRunRecord } from '@shared/types/orchestration'
import { useEffect, useRef, useState } from 'react'
import { ChatPanel } from '@/components/chat/ChatPanel'
import type { OrchestrationProps } from '@/components/chat/types'
import { DiffPanel } from '@/components/diff-panel/DiffPanel'
import { ResizeHandle } from '@/components/diff-panel/ResizeHandle'
import { Header } from '@/components/layout/Header'
import { Sidebar } from '@/components/layout/Sidebar'
import { SettingsDialog } from '@/components/settings/SettingsDialog'
import { SkillsPanel } from '@/components/skills/SkillsPanel'
import { TerminalPanel } from '@/components/terminal/TerminalPanel'
import { useAgentChat } from '@/hooks/useAgentChat'
import { useChat } from '@/hooks/useChat'
import { useGit } from '@/hooks/useGit'
import { useProject } from '@/hooks/useProject'
import { useSettings, useSettingsSetup } from '@/hooks/useSettings'
import { useSkills } from '@/hooks/useSkills'
import { cn } from '@/lib/cn'
import { api } from '@/lib/ipc'
import { isTerminalChunk } from '@/lib/ipc-connection-adapter'
import { useChatStore } from '@/stores/chat-store'

export function App(): React.JSX.Element {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [activeView, setActiveView] = useState<'chat' | 'skills'>('chat')
  const [diffPanelOpen, setDiffPanelOpen] = useState(false)
  const [diffPanelWidth, setDiffPanelWidth] = useState(600)
  const [diffRefreshKey, setDiffRefreshKey] = useState(0)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [orchestrationRuns, setOrchestrationRuns] = useState<OrchestrationRunRecord[]>([])
  const [orchestrationEvents, setOrchestrationEvents] = useState<OrchestrationEventPayload[]>([])

  const DIFF_PANEL_MIN = 360
  const DIFF_PANEL_MAX = 900
  const CHAT_MIN_WIDTH = 420

  useSettingsSetup()

  const { settings, isLoaded } = useSettings()
  const { projectPath, selectFolder, setProjectPath } = useProject()
  const {
    standardsStatus,
    catalog: skillCatalog,
    selectedSkillId,
    previewMarkdown,
    isLoading: skillsLoading,
    isPreviewLoading: skillPreviewLoading,
    error: skillsError,
    refresh: refreshSkills,
    selectSkill,
    toggleSkill,
  } = useSkills(projectPath)
  const { refreshStatus: refreshGitStatus, refreshBranches: refreshGitBranches } = useGit()
  const {
    conversations,
    activeConversation,
    activeConversationId,
    createConversation,
    setActiveConversation,
    deleteConversation,
    updateConversationProjectPath,
    loadConversations,
  } = useChat()

  useEffect(() => {
    loadConversations()
  }, [loadConversations])

  useEffect(() => {
    void refreshGitStatus(projectPath)
    void refreshGitBranches(projectPath)
  }, [projectPath, refreshGitStatus, refreshGitBranches])

  const currentModel = settings.defaultModel

  const conversation = useChatStore((s) => s.activeConversation)
  const messageModelLookup: Record<string, SupportedModelId> = {}
  for (const msg of conversation?.messages ?? []) {
    if (msg.role === 'assistant' && msg.model) {
      messageModelLookup[String(msg.id)] = msg.model
    }
  }
  const { messages, sendMessage, isLoading, stop, error, respondToolApproval, answerQuestion } =
    useAgentChat(activeConversationId, conversation, currentModel, settings.qualityPreset)

  const pendingMessage = useRef<AgentSendPayload | null>(null)

  useEffect(() => {
    if (!toastMessage) return
    const timer = setTimeout(() => setToastMessage(null), 3500)
    return () => clearTimeout(timer)
  }, [toastMessage])

  function showToast(message: string): void {
    setToastMessage(message)
  }

  useEffect(() => {
    if (activeConversationId && pendingMessage.current) {
      const payload = pendingMessage.current
      pendingMessage.current = null
      void sendMessage(payload)
    }
  }, [activeConversationId, sendMessage])

  useEffect(() => {
    if (!activeConversationId) {
      setOrchestrationRuns([])
      setOrchestrationEvents([])
      return
    }

    void api.listOrchestrationRuns(activeConversationId).then((runs) => setOrchestrationRuns(runs))

    const unsubscribe = api.onOrchestrationEvent((event) => {
      if (event.conversationId !== activeConversationId) return
      setOrchestrationEvents((previous) => [event, ...previous].slice(0, 80))
      void api
        .listOrchestrationRuns(activeConversationId)
        .then((runs) => setOrchestrationRuns(runs))
    })

    return unsubscribe
  }, [activeConversationId])

  // Debounced git refresh for stream-chunk events
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
          void Promise.all([refreshGitStatus(projectPath), refreshGitBranches(projectPath)])
          setDiffRefreshKey((k) => k + 1)
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
    refreshGitBranches,
    refreshGitStatus,
    setActiveConversation,
  ])

  // Refresh git status + diff panel when window regains focus
  useEffect(() => {
    function handleFocus() {
      if (projectPath) {
        void Promise.all([refreshGitStatus(projectPath), refreshGitBranches(projectPath)])
        setDiffRefreshKey((k) => k + 1)
      }
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [projectPath, refreshGitBranches, refreshGitStatus])

  async function handleSelectConversation(id: Parameters<typeof setActiveConversation>[0]) {
    setActiveView('chat')
    const conv = conversations.find((c) => c.id === id)
    const nextProjectPath = conv?.projectPath ?? projectPath
    if (conv && conv.projectPath !== projectPath) {
      await setProjectPath(conv.projectPath)
    }
    await setActiveConversation(id)
    void Promise.all([refreshGitStatus(nextProjectPath), refreshGitBranches(nextProjectPath)])
  }

  async function handleNewConversation() {
    setActiveView('chat')
    await createConversation(projectPath)
  }

  async function handleOpenProject() {
    setActiveView('chat')
    const path = await selectFolder()
    if (path) {
      if (activeConversationId) {
        await updateConversationProjectPath(activeConversationId, path)
        await setProjectPath(path)
        await setActiveConversation(activeConversationId)
      } else {
        await createConversation(path)
      }
      void Promise.all([refreshGitStatus(path), refreshGitBranches(path)])
    }
  }

  async function handleSelectProjectPath(path: string) {
    setActiveView('chat')
    if (activeConversationId) {
      await updateConversationProjectPath(activeConversationId, path)
      await setProjectPath(path)
      await setActiveConversation(activeConversationId)
      void refreshGitStatus(path)
      void refreshGitBranches(path)
      return
    }
    await setProjectPath(path)
    await createConversation(path)
    void Promise.all([refreshGitStatus(path), refreshGitBranches(path)])
  }

  async function handleSend(payload: AgentSendPayload) {
    if (!activeConversationId) {
      pendingMessage.current = payload
      await createConversation(projectPath)
      return
    }
    await sendMessage(payload)
  }

  async function handleSendText(content: string) {
    await handleSend({
      text: content,
      qualityPreset: settings.qualityPreset,
      attachments: [],
    })
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
      if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
        e.preventDefault()
        setDiffPanelOpen((prev) => !prev)
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

  const orchestrationPropsBundle: OrchestrationProps = {
    orchestrationRuns,
    orchestrationEvents,
    onCancelOrchestrationRun: (runId) => api.cancelOrchestrationRun(runId),
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
          activeView={activeView}
          onSelect={handleSelectConversation}
          onDelete={deleteConversation}
          onNew={handleNewConversation}
          onOpenProject={handleOpenProject}
          onOpenSkills={() => {
            setActiveView('skills')
            setDiffPanelOpen(false)
          }}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      </div>

      {/* Main panel */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header
          conversationTitle={activeConversation?.title ?? null}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          onToggleTerminal={() => setTerminalOpen(!terminalOpen)}
          onToggleDiffPanel={() => setDiffPanelOpen(!diffPanelOpen)}
          sidebarOpen={sidebarOpen}
          terminalOpen={terminalOpen}
          onDiffRefresh={() => setDiffRefreshKey((k) => k + 1)}
          onToast={showToast}
        />

        {/* Main content */}
        <div className="flex flex-1 overflow-hidden">
          {activeView === 'skills' ? (
            <SkillsPanel
              projectPath={projectPath}
              standardsStatus={standardsStatus}
              catalog={skillCatalog}
              selectedSkillId={selectedSkillId}
              previewMarkdown={previewMarkdown}
              isLoading={skillsLoading}
              isPreviewLoading={skillPreviewLoading}
              error={skillsError}
              onRefresh={() => {
                void refreshSkills()
              }}
              onSelectSkill={selectSkill}
              onToggleSkill={(skillId, enabled) => {
                void toggleSkill(skillId, enabled)
              }}
            />
          ) : (
            <>
              <div className="flex min-w-0 flex-1 justify-center overflow-hidden">
                <ChatPanel
                  messages={messages}
                  isLoading={isLoading}
                  error={error}
                  projectPath={projectPath}
                  hasProject={!!projectPath}
                  conversationId={activeConversationId}
                  onOpenProject={handleOpenProject}
                  onSelectProjectPath={handleSelectProjectPath}
                  onOpenSettings={() => setSettingsOpen(true)}
                  onRetry={handleSendText}
                  onSend={handleSend}
                  onToast={showToast}
                  onCancel={stop}
                  onToolApprovalResponse={respondToolApproval}
                  onAnswerQuestion={answerQuestion}
                  model={currentModel}
                  messageModelLookup={messageModelLookup}
                  slashSkills={skillCatalog?.skills ?? []}
                  orchestration={orchestrationPropsBundle}
                  recentProjects={settings.recentProjects}
                />
              </div>

              {/* Resize handle + Diff panel */}
              {diffPanelOpen && (
                <>
                  <ResizeHandle
                    onResize={(delta) =>
                      setDiffPanelWidth((w) =>
                        Math.min(DIFF_PANEL_MAX, Math.max(DIFF_PANEL_MIN, w + delta)),
                      )
                    }
                    onResizeEnd={() => {}}
                  />
                  <div
                    className="shrink-0 overflow-hidden"
                    style={{
                      width: `min(${String(diffPanelWidth)}px, max(0px, calc(100% - ${String(CHAT_MIN_WIDTH)}px)))`,
                    }}
                  >
                    <DiffPanel
                      key={diffRefreshKey}
                      projectPath={projectPath}
                      onSendMessage={handleSendText}
                    />
                  </div>
                </>
              )}
            </>
          )}
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

      {toastMessage && (
        <div className="pointer-events-none fixed right-5 top-5 z-[70] rounded-lg border border-border-light bg-bg-secondary px-3 py-2 text-[13px] text-text-secondary shadow-lg">
          {toastMessage}
        </div>
      )}
    </div>
  )
}
