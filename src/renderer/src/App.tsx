import type { AgentSendPayload } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import type { MultiAgentConfig } from '@shared/types/multi-agent'
import { useEffect } from 'react'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { DiffPanel } from '@/components/diff-panel/DiffPanel'
import { ResizeHandle } from '@/components/diff-panel/ResizeHandle'
import { Header } from '@/components/layout/Header'
import { Sidebar } from '@/components/layout/Sidebar'
import { SettingsPage } from '@/components/settings/SettingsPage'
import { PanelErrorBoundary } from '@/components/shared/PanelErrorBoundary'
import { SkillsPanel } from '@/components/skills/SkillsPanel'
import { TerminalPanel } from '@/components/terminal/TerminalPanel'
import { useAgentChat } from '@/hooks/useAgentChat'
import { useChat } from '@/hooks/useChat'
import { useConversationNav } from '@/hooks/useConversationNav'
import { useGit } from '@/hooks/useGit'
import { useGitRefresh } from '@/hooks/useGitRefresh'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useMessageModelLookup } from '@/hooks/useMessageModelLookup'
import { useMultiAgentChat } from '@/hooks/useMultiAgentChat'
import { useMultiAgentMetadataLookup } from '@/hooks/useMultiAgentMetadataLookup'
import { useOrchestration } from '@/hooks/useOrchestration'
import { useProject } from '@/hooks/useProject'
import { useSendMessage } from '@/hooks/useSendMessage'
import { useSettings, useSettingsSetup } from '@/hooks/useSettings'
import { useSkills } from '@/hooks/useSkills'
import { cn } from '@/lib/cn'
import { api } from '@/lib/ipc'
import { useChatStore } from '@/stores/chat-store'
import { useMultiAgentStore } from '@/stores/multi-agent-store'
import { CHAT_MIN_WIDTH, useUIStore } from '@/stores/ui-store'

export function App(): React.JSX.Element {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const terminalOpen = useUIStore((s) => s.terminalOpen)
  const activeView = useUIStore((s) => s.activeView)
  const diffPanelOpen = useUIStore((s) => s.diffPanelOpen)
  const diffPanelWidth = useUIStore((s) => s.diffPanelWidth)
  const toastMessage = useUIStore((s) => s.toastMessage)

  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const toggleTerminal = useUIStore((s) => s.toggleTerminal)
  const toggleDiffPanel = useUIStore((s) => s.toggleDiffPanel)
  const openSettings = useUIStore((s) => s.openSettings)
  const setActiveView = useUIStore((s) => s.setActiveView)
  const openSkillsView = useUIStore((s) => s.openSkillsView)
  const resizeDiffPanel = useUIStore((s) => s.resizeDiffPanel)
  const closeTerminal = useUIStore((s) => s.closeTerminal)
  const showToast = useUIStore((s) => s.showToast)

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

  const currentModel = settings.defaultModel
  const conversation = useChatStore((s) => s.activeConversation)
  const {
    messages,
    sendMessage,
    sendMultiAgentMessage,
    isLoading,
    stop,
    error,
    respondToolApproval,
    answerQuestion,
  } = useAgentChat(activeConversationId, conversation, currentModel, settings.qualityPreset)

  const { orchestrationRuns, orchestrationEvents, cancelRun } =
    useOrchestration(activeConversationId)

  // --- Composable workflow hooks ---

  const {
    handleSelectConversation,
    handleNewConversation,
    handleOpenProject,
    handleSelectProjectPath,
  } = useConversationNav({
    conversations,
    activeConversationId,
    projectPath,
    setActiveView,
    setProjectPath,
    selectFolder,
    createConversation,
    setActiveConversation,
    updateConversationProjectPath,
    refreshGitStatus,
    refreshGitBranches,
  })

  const { handleSend, handleSendText, handleSendMultiAgent } = useSendMessage({
    activeConversationId,
    projectPath,
    qualityPreset: settings.qualityPreset,
    createConversation,
    sendMessage,
    sendMultiAgentMessage,
  })

  const messageModelLookup = useMessageModelLookup(conversation)
  const multiAgentMetadataLookup = useMultiAgentMetadataLookup(conversation, messages)

  // --- Multi-agent ---

  useMultiAgentChat(activeConversationId)

  const multiAgentStatus = useMultiAgentStore((s) => s.status)
  const multiAgentConfig = useMultiAgentStore((s) => s.activeConfig)
  const setMultiAgentConfig = useMultiAgentStore((s) => s.setConfig)
  const startMultiAgentCollaboration = useMultiAgentStore((s) => s.startCollaboration)
  const stopMultiAgentCollaboration = useMultiAgentStore((s) => s.stopCollaboration)
  const toggleCommandPalette = useUIStore((s) => s.toggleCommandPalette)

  function handleStartWaggle(config: MultiAgentConfig): void {
    setMultiAgentConfig(config)
  }

  function handleStopCollaboration(): void {
    if (activeConversationId) {
      api.cancelMultiAgent(activeConversationId)
    }
    stopMultiAgentCollaboration()
  }

  // When multi-agent is configured, route sends through the useChat pipeline
  async function handleSendWithMultiAgent(payload: AgentSendPayload): Promise<void> {
    if (multiAgentConfig && multiAgentStatus === 'idle') {
      startMultiAgentCollaboration(activeConversationId ?? ('' as ConversationId), multiAgentConfig)
      await handleSendMultiAgent(payload, multiAgentConfig)
      return
    }
    await handleSend(payload)
  }

  // --- Lifecycle effects ---

  useEffect(() => {
    void loadConversations()
  }, [loadConversations])

  useEffect(() => {
    void refreshGitStatus(projectPath)
    void refreshGitBranches(projectPath)
  }, [projectPath, refreshGitStatus, refreshGitBranches])

  // --- Other hooks ---

  const { diffRefreshKey, bumpDiffRefreshKey } = useGitRefresh({
    projectPath,
    activeConversationId,
    refreshGitStatus,
    refreshGitBranches,
    loadConversations,
    setActiveConversation,
  })

  useKeyboardShortcuts([
    { key: 'j', ctrl: true, action: toggleTerminal },
    { key: 'n', ctrl: true, action: () => void createConversation(projectPath) },
    { key: 'b', ctrl: true, action: toggleSidebar },
    { key: 'd', ctrl: true, action: toggleDiffPanel },
    { key: 'k', ctrl: true, action: toggleCommandPalette },
  ])

  if (!isLoaded) {
    return (
      <div className="flex h-full items-center justify-center bg-bg">
        <div className="text-text-tertiary text-sm">Loading...</div>
      </div>
    )
  }

  // Settings takes over the full screen — no sidebar, header, or terminal
  if (activeView === 'settings') {
    return (
      <div className="flex h-full w-full overflow-hidden bg-bg">
        <PanelErrorBoundary name="Settings" className="flex flex-1 overflow-hidden">
          <SettingsPage />
        </PanelErrorBoundary>

        {toastMessage && (
          <div className="pointer-events-none fixed right-5 top-5 z-[70] rounded-lg border border-border-light bg-bg-secondary px-3 py-2 text-[13px] text-text-secondary shadow-lg">
            {toastMessage}
          </div>
        )}
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
          activeView={activeView}
          onSelect={handleSelectConversation}
          onDelete={deleteConversation}
          onNew={handleNewConversation}
          onOpenProject={handleOpenProject}
          onOpenSkills={openSkillsView}
          onOpenSettings={openSettings}
        />
      </div>

      {/* Main panel */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header
          conversationTitle={activeConversation?.title ?? null}
          onToggleSidebar={toggleSidebar}
          onToggleTerminal={toggleTerminal}
          onToggleDiffPanel={toggleDiffPanel}
          sidebarOpen={sidebarOpen}
          terminalOpen={terminalOpen}
          onDiffRefresh={bumpDiffRefreshKey}
          onToast={showToast}
        />

        {/* Main content */}
        <div className="flex flex-1 overflow-hidden">
          {activeView === 'skills' ? (
            <PanelErrorBoundary name="Skills" className="flex flex-1 overflow-hidden">
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
            </PanelErrorBoundary>
          ) : (
            <>
              <PanelErrorBoundary
                name="Chat"
                className="flex min-w-0 flex-1 justify-center overflow-hidden"
              >
                <ChatPanel
                  messages={messages}
                  isLoading={isLoading}
                  error={error}
                  projectPath={projectPath}
                  hasProject={!!projectPath}
                  conversationId={activeConversationId}
                  onOpenProject={handleOpenProject}
                  onSelectProjectPath={handleSelectProjectPath}
                  onOpenSettings={openSettings}
                  onRetry={handleSendText}
                  onSend={handleSendWithMultiAgent}
                  onToast={showToast}
                  onCancel={stop}
                  onToolApprovalResponse={respondToolApproval}
                  onAnswerQuestion={answerQuestion}
                  model={currentModel}
                  messageModelLookup={messageModelLookup}
                  multiAgentMetadataLookup={multiAgentMetadataLookup}
                  slashSkills={skillCatalog?.skills ?? []}
                  orchestration={{
                    orchestrationRuns,
                    orchestrationEvents,
                    onCancelOrchestrationRun: cancelRun,
                  }}
                  recentProjects={settings.recentProjects}
                  onStopCollaboration={
                    multiAgentStatus !== 'idle' ? handleStopCollaboration : undefined
                  }
                  onStartWaggle={handleStartWaggle}
                />
              </PanelErrorBoundary>

              {/* Resize handle + Diff panel */}
              {diffPanelOpen && (
                <>
                  <ResizeHandle onResize={resizeDiffPanel} onResizeEnd={() => {}} />
                  <div
                    className="shrink-0 overflow-hidden"
                    style={{
                      width: `min(${String(diffPanelWidth)}px, max(0px, calc(100% - ${String(CHAT_MIN_WIDTH)}px)))`,
                    }}
                  >
                    <PanelErrorBoundary name="Diff">
                      <DiffPanel
                        key={diffRefreshKey}
                        projectPath={projectPath}
                        onSendMessage={handleSendText}
                      />
                    </PanelErrorBoundary>
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
            <PanelErrorBoundary name="Terminal">
              <TerminalPanel projectPath={projectPath} onClose={closeTerminal} />
            </PanelErrorBoundary>
          )}
        </div>
      </div>

      {toastMessage && (
        <div className="pointer-events-none fixed right-5 top-5 z-[70] rounded-lg border border-border-light bg-bg-secondary px-3 py-2 text-[13px] text-text-secondary shadow-lg">
          {toastMessage}
        </div>
      )}
    </div>
  )
}
