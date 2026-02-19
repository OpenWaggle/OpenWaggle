import type { AgentSendPayload } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import type { GitBranchListResult, GitBranchMutationResult } from '@shared/types/git'
import type { ProviderInfo, SupportedModelId } from '@shared/types/llm'
import type { QuestionAnswer } from '@shared/types/question'
import type { ExecutionMode, QualityPreset, Settings as SettingsType } from '@shared/types/settings'
import type { UIMessage } from '@tanstack/ai-react'
import {
  AlertCircle,
  ChevronDown,
  FileText,
  FolderOpen,
  Gamepad2,
  PencilLine,
  RefreshCw,
  Settings,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import openhiveMark from '@/assets/openhive-mark.png'
import { Composer } from '@/components/composer/Composer'
import { Spinner } from '@/components/shared/Spinner'
import { projectName } from '@/lib/format'
import { ApprovalBanner } from './ApprovalBanner'
import { MessageBubble } from './MessageBubble'

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
  gitBranch?: string | null
  gitBranches?: GitBranchListResult | null
  isBranchActionRunning?: boolean
  onCheckoutBranch?: (name: string) => Promise<GitBranchMutationResult>
  onCreateBranch?: (
    name: string,
    startPoint?: string,
    checkout?: boolean,
  ) => Promise<GitBranchMutationResult>
  onRenameBranch?: (from: string, to: string) => Promise<GitBranchMutationResult>
  onDeleteBranch?: (name: string, force?: boolean) => Promise<GitBranchMutationResult>
  onSetBranchUpstream?: (name: string, upstream: string) => Promise<GitBranchMutationResult>
  onRefreshGit?: () => void
  isRefreshingGit?: boolean
}

function classifyError(message: string): {
  hint: string
  isAuthError: boolean
  isRateLimit: boolean
} {
  const lower = message.toLowerCase()
  if (
    lower.includes('api key') ||
    lower.includes('401') ||
    lower.includes('403') ||
    lower.includes('unauthorized') ||
    lower.includes('authentication')
  ) {
    return { hint: 'Check your API key in settings', isAuthError: true, isRateLimit: false }
  }
  if (
    lower.includes('rate limit') ||
    lower.includes('429') ||
    lower.includes('too many requests')
  ) {
    return { hint: 'Rate limited — try again in a moment', isAuthError: false, isRateLimit: true }
  }
  if (
    lower.includes('model') &&
    (lower.includes('not found') || lower.includes('not exist') || lower.includes('invalid'))
  ) {
    return {
      hint: 'The selected model may not be available — try a different one',
      isAuthError: false,
      isRateLimit: false,
    }
  }
  return { hint: '', isAuthError: false, isRateLimit: false }
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
  gitBranch,
  gitBranches,
  isBranchActionRunning,
  onCheckoutBranch,
  onCreateBranch,
  onRenameBranch,
  onDeleteBranch,
  onSetBranchUpstream,
  onRefreshGit,
  isRefreshingGit,
}: ChatPanelProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout>>(null)
  const projectMenuRef = useRef<HTMLDivElement>(null)
  const [dismissedError, setDismissedError] = useState<string | null>(null)
  const [projectMenuOpen, setProjectMenuOpen] = useState(false)
  const starterPrompts = [
    { label: 'Build a coding game in this repo', icon: Gamepad2 },
    { label: 'Draft a one-page summary of this app', icon: FileText },
    { label: 'Create a refactor plan for this feature', icon: PencilLine },
  ]

  const lastMsg = messages[messages.length - 1]
  const lastIsStreaming = isLoading && lastMsg?.role === 'assistant'
  const recentProjects = settings.recentProjects

  useEffect(() => {
    if (!conversationId || messages.length === 0) return
    if (lastIsStreaming) return
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [conversationId, messages.length, lastIsStreaming])

  useEffect(() => {
    if (!projectMenuOpen) return
    function handleClickOutside(event: MouseEvent): void {
      if (projectMenuRef.current && !projectMenuRef.current.contains(event.target as Node)) {
        setProjectMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [projectMenuOpen])

  function handleScroll() {
    const el = scrollRef.current
    if (!el) return
    el.classList.add('is-scrolling')
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
    scrollTimerRef.current = setTimeout(() => {
      el.classList.remove('is-scrolling')
    }, 1200)
  }

  function handleChooseProject(path: string): void {
    setProjectMenuOpen(false)
    void onSelectProjectPath?.(path)
  }

  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')
  const lastUserMessage =
    lastUserMsg?.parts
      .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
      .map((p) => p.content)
      .join('\n') ?? null

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
          <div className="mx-auto flex min-h-full w-full max-w-[720px] px-12 py-5">
            <div className="flex w-full flex-col pt-8">
              <div className="flex flex-1 items-center justify-center pb-20">
                <div className="flex flex-col items-center text-center">
                  <img
                    src={openhiveMark}
                    alt="OpenHive logo"
                    className="h-20 w-20 object-contain"
                  />
                  <div className="mt-5 space-y-1.5">
                    <h2 className="text-[clamp(40px,5vw,54px)] leading-none font-semibold tracking-tight text-text-primary">
                      Let&apos;s build
                    </h2>
                    <div ref={projectMenuRef} className="relative inline-flex">
                      {hasProject ? (
                        <button
                          type="button"
                          onClick={() => setProjectMenuOpen((prev) => !prev)}
                          className="inline-flex max-w-full items-center gap-1 text-[clamp(28px,3.8vw,40px)] leading-none text-text-secondary transition-colors hover:text-text-primary"
                          title="Open project picker"
                        >
                          <span className="truncate">{projectName(projectPath)}</span>
                          <ChevronDown className="mt-1 h-5 w-5" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setProjectMenuOpen((prev) => !prev)}
                          className="inline-flex max-w-sm items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm text-text-tertiary transition-colors hover:border-border-light hover:text-text-secondary"
                          title="Open project picker"
                        >
                          <FolderOpen className="h-4 w-4 shrink-0" />
                          <span>Select a project folder to get started</span>
                        </button>
                      )}

                      {projectMenuOpen && (
                        <div className="absolute left-1/2 top-full z-20 mt-3 w-[340px] -translate-x-1/2 rounded-xl border border-border-light bg-bg-secondary p-2 shadow-xl">
                          <button
                            type="button"
                            onClick={() => {
                              setProjectMenuOpen(false)
                              onOpenProject?.()
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-text-secondary transition-colors hover:bg-bg-hover"
                          >
                            <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                            Select folder…
                          </button>

                          {recentProjects.length > 0 && (
                            <div className="mt-1 border-t border-border pt-1">
                              <div className="px-2.5 py-1 text-[11px] uppercase tracking-wide text-text-muted">
                                Recent projects
                              </div>
                              {recentProjects.map((path) => (
                                <button
                                  key={path}
                                  type="button"
                                  onClick={() => handleChooseProject(path)}
                                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-text-secondary transition-colors hover:bg-bg-hover"
                                >
                                  <FolderOpen className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
                                  <span className="min-w-0 flex-1 truncate">
                                    {projectName(path)}
                                  </span>
                                  {path === projectPath && (
                                    <span className="text-[11px] text-text-muted">Current</span>
                                  )}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="pb-6">
                <div className="mb-3 pr-2 text-right text-[13px] text-text-tertiary">
                  Explore more
                </div>
                <div className="grid grid-cols-3 gap-4">
                  {starterPrompts.map((prompt) => (
                    <button
                      type="button"
                      key={prompt.label}
                      onClick={() => onRetry?.(prompt.label)}
                      className="group flex min-h-[98px] flex-col rounded-2xl border border-border bg-bg-secondary px-5 py-3.5 text-left transition-all hover:-translate-y-0.5 hover:border-accent/50 hover:bg-bg-hover/45 hover:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-accent)_18%,transparent)]"
                    >
                      <span className="mb-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-bg/80">
                        <prompt.icon className="h-3.5 w-3.5 text-text-secondary transition-colors group-hover:text-text-primary" />
                      </span>
                      <p className="text-[14px] leading-snug text-text-primary/92">
                        {prompt.label}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Messages list — centered, gap 24 between message groups */
          <div className="mx-auto w-full max-w-[720px] px-12 py-5">
            <div className="flex flex-col gap-6 w-full">
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

              {error &&
                !isLoading &&
                dismissedError !== error.message &&
                (() => {
                  const { hint, isAuthError, isRateLimit } = classifyError(error.message)
                  return (
                    <div className="my-3 rounded-xl border border-error/25 bg-error/6 px-4 py-3">
                      <div className="flex items-start gap-3">
                        <AlertCircle className="h-4 w-4 shrink-0 text-error mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-error/90">{error.message}</p>
                          {hint && <p className="text-[13px] text-text-tertiary mt-1">{hint}</p>}
                          <div className="flex gap-2 mt-2">
                            {isAuthError && onOpenSettings && (
                              <button
                                type="button"
                                onClick={onOpenSettings}
                                className="flex items-center gap-1.5 rounded-md bg-accent/10 px-2.5 py-1 text-[13px] font-medium text-accent hover:bg-accent/20 transition-colors"
                              >
                                <Settings className="h-3 w-3" />
                                Open Settings
                              </button>
                            )}
                            {lastUserMessage && !isRateLimit && onRetry && (
                              <button
                                type="button"
                                onClick={() => {
                                  setDismissedError(error.message)
                                  onRetry(lastUserMessage)
                                }}
                                className="flex items-center gap-1.5 rounded-md bg-error/10 px-2.5 py-1 text-[13px] font-medium text-error hover:bg-error/20 transition-colors"
                              >
                                <RefreshCw className="h-3 w-3" />
                                Retry
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setDismissedError(error.message)}
                              className="flex items-center gap-1.5 rounded-md bg-bg-hover px-2.5 py-1 text-[13px] font-medium text-text-tertiary hover:text-text-secondary transition-colors"
                            >
                              <X className="h-3 w-3" />
                              Dismiss
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })()}
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
          projectPath={projectPath}
          gitBranch={gitBranch}
          gitBranches={gitBranches}
          isBranchActionRunning={isBranchActionRunning}
          onCheckoutBranch={onCheckoutBranch}
          onCreateBranch={onCreateBranch}
          onRenameBranch={onRenameBranch}
          onDeleteBranch={onDeleteBranch}
          onSetBranchUpstream={onSetBranchUpstream}
          onRefreshGit={onRefreshGit}
          isRefreshingGit={isRefreshingGit}
          onExecutionModeChange={onExecutionModeChange}
          onQualityPresetChange={onQualityPresetChange}
          onToast={onToast}
        />
      </div>
    </div>
  )
}
