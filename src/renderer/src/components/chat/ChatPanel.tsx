import type { AgentSendPayload } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import type { ProviderInfo, SupportedModelId } from '@shared/types/llm'
import type { QuestionAnswer } from '@shared/types/question'
import type { ExecutionMode, QualityPreset, Settings as SettingsType } from '@shared/types/settings'
import type { SkillDiscoveryItem } from '@shared/types/standards'
import type { UIMessage } from '@tanstack/ai-react'
import { useState } from 'react'
import { Composer } from '@/components/composer/Composer'
import { Spinner } from '@/components/shared/Spinner'
import { ApprovalBanner } from './ApprovalBanner'
import { ChatErrorDisplay } from './ChatErrorDisplay'
import { MessageBubble } from './MessageBubble'
import { OrchestrationRunBanner } from './OrchestrationRunBanner'
import type { GitProps, OrchestrationProps } from './types'
import { useAutoScroll } from './useAutoScroll'
import { WelcomeScreen } from './WelcomeScreen'

interface ChatPanelProps {
  messages: UIMessage[]
  isLoading: boolean
  error: Error | undefined
  projectPath: string | null
  hasProject: boolean
  conversationId: ConversationId | null
  onOpenProject?: () => void
  onSelectProjectPath?: (path: string) => Promise<void> | void
  onOpenSettings?: () => void
  onRetry?: (content: string) => void
  onSend: (payload: AgentSendPayload) => void
  onToast?: (message: string) => void
  onCancel: () => void
  onToolApprovalResponse: (approvalId: string, approved: boolean) => Promise<void>
  onAnswerQuestion: (conversationId: ConversationId, answers: QuestionAnswer[]) => Promise<void>
  onExecutionModeChange?: (mode: ExecutionMode) => Promise<void> | void
  onQualityPresetChange?: (preset: QualityPreset) => Promise<void> | void
  model: SupportedModelId
  onModelChange: (model: SupportedModelId) => void
  settings: SettingsType
  providerModels: ProviderInfo[]
  messageModelLookup: Readonly<Record<string, SupportedModelId>>
  slashSkills: readonly SkillDiscoveryItem[]
  git: GitProps
  orchestration: OrchestrationProps
}

export function ChatPanel({
  messages,
  isLoading,
  error,
  projectPath,
  hasProject,
  conversationId,
  onOpenProject,
  onSelectProjectPath,
  onOpenSettings,
  onRetry,
  onSend,
  onToast,
  onCancel,
  onToolApprovalResponse,
  onAnswerQuestion,
  onExecutionModeChange,
  onQualityPresetChange,
  model,
  onModelChange,
  settings,
  providerModels,
  messageModelLookup,
  slashSkills,
  git,
  orchestration,
}: ChatPanelProps): React.JSX.Element {
  const [dismissedError, setDismissedError] = useState<string | null>(null)

  const lastMsg = messages[messages.length - 1]
  const lastIsStreaming = isLoading && lastMsg?.role === 'assistant'

  const { scrollRef, handleScroll } = useAutoScroll({
    enabled: !!conversationId && messages.length > 0,
    skipWhileStreaming: lastIsStreaming,
  })

  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')
  const lastUserMessage =
    lastUserMsg?.parts
      .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
      .map((p) => p.content)
      .join('\n') ?? null

  const {
    orchestrationRuns = [],
    orchestrationEvents = [],
    onCancelOrchestrationRun,
  } = orchestration
  const latestOrchestrationRun = orchestrationRuns[0]
  const latestRunEvents = latestOrchestrationRun
    ? orchestrationEvents
        .filter((event) => event.runId === latestOrchestrationRun.runId)
        .slice(0, 6)
    : []

  // Find the first pending tool approval across all messages
  let pendingApproval: {
    toolName: string
    toolArgs: string
    approvalId: string
  } | null = null
  for (const msg of messages) {
    if (pendingApproval) break
    for (const part of msg.parts) {
      if (part.type === 'tool-call' && part.state === 'approval-requested' && part.approval?.id) {
        pendingApproval = {
          toolName: part.name,
          toolArgs: part.arguments,
          approvalId: part.approval.id,
        }
        break
      }
    }
  }

  return (
    <div className="flex h-full w-full flex-col bg-bg overflow-hidden">
      {/* Scroll container — full width so scrollbar sits at right edge */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto chat-scroll">
        {messages.length === 0 && !isLoading ? (
          <WelcomeScreen
            projectPath={projectPath}
            hasProject={hasProject}
            recentProjects={settings.recentProjects}
            onOpenProject={onOpenProject}
            onSelectProjectPath={onSelectProjectPath}
            onRetry={onRetry}
          />
        ) : (
          /* Messages list — centered, gap 24 between message groups */
          <div className="mx-auto w-full max-w-[720px] px-12 py-5">
            <div className="flex flex-col gap-6 w-full">
              {latestOrchestrationRun && (
                <OrchestrationRunBanner
                  run={latestOrchestrationRun}
                  events={latestRunEvents}
                  lastUserMessage={lastUserMessage}
                  onCancelOrchestrationRun={onCancelOrchestrationRun}
                  onRetry={onRetry}
                />
              )}

              {messages.map((msg, i) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  isStreaming={lastIsStreaming && i === messages.length - 1}
                  assistantModel={
                    msg.role === 'assistant' ? (messageModelLookup[msg.id] ?? model) : undefined
                  }
                  conversationId={conversationId}
                  onAnswerQuestion={onAnswerQuestion}
                />
              ))}

              {isLoading &&
                (!lastMsg || lastMsg.role !== 'assistant' || lastMsg.parts.length === 0) && (
                  <div className="flex items-center gap-2 py-3">
                    <Spinner size="sm" className="text-accent" />
                    <span className="text-sm text-text-tertiary">Thinking...</span>
                  </div>
                )}

              {error && !isLoading && (
                <ChatErrorDisplay
                  error={error}
                  lastUserMessage={lastUserMessage}
                  dismissedError={dismissedError}
                  onDismiss={setDismissedError}
                  onOpenSettings={onOpenSettings}
                  onRetry={onRetry}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Pinned approval banner — always visible above composer */}
      {pendingApproval && (
        <div className="mx-auto w-full max-w-[720px] px-5 pb-2">
          <ApprovalBanner
            toolName={pendingApproval.toolName}
            toolArgs={pendingApproval.toolArgs}
            approvalId={pendingApproval.approvalId}
            onApprovalResponse={onToolApprovalResponse}
          />
        </div>
      )}

      {/* Chat input card — centered to match content width */}
      <div className="mx-auto w-full max-w-[720px] px-5 pb-5">
        <Composer
          onSend={onSend}
          onCancel={onCancel}
          isLoading={isLoading}
          model={model}
          onModelChange={onModelChange}
          settings={settings}
          providerModels={providerModels}
          slashSkills={slashSkills}
          projectPath={projectPath}
          gitBranch={git.gitBranch}
          gitBranches={git.gitBranches}
          isBranchActionRunning={git.isBranchActionRunning}
          onCheckoutBranch={git.onCheckoutBranch}
          onCreateBranch={git.onCreateBranch}
          onRenameBranch={git.onRenameBranch}
          onDeleteBranch={git.onDeleteBranch}
          onSetBranchUpstream={git.onSetBranchUpstream}
          onRefreshGit={git.onRefreshGit}
          isRefreshingGit={git.isRefreshingGit}
          onExecutionModeChange={onExecutionModeChange}
          onQualityPresetChange={onQualityPresetChange}
          onToast={onToast}
        />
      </div>
    </div>
  )
}
