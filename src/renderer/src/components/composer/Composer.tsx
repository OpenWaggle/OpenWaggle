import type { AgentSendPayload, PreparedAttachment } from '@shared/types/agent'
import type {
  GitBranchListResult,
  GitBranchMutationResult,
  GitBranchSetUpstreamPayload,
} from '@shared/types/git'
import type { ProviderInfo, SupportedModelId } from '@shared/types/llm'
import type { ExecutionMode, QualityPreset, Settings as SettingsType } from '@shared/types/settings'
import { ArrowUp, GitBranch, Loader2, Mic, Plus, RefreshCw, Square, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ModelSelector } from '@/components/shared/ModelSelector'
import { cn } from '@/lib/cn'
import { api } from '@/lib/ipc'

interface ComposerProps {
  onSend: (payload: AgentSendPayload) => void
  onCancel: () => void
  isLoading: boolean
  disabled?: boolean
  model: SupportedModelId
  onModelChange: (model: SupportedModelId) => void
  settings: SettingsType
  providerModels: ProviderInfo[]
  projectPath?: string | null
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
  onSetBranchUpstream?: (
    name: string,
    upstream: GitBranchSetUpstreamPayload['upstream'],
  ) => Promise<GitBranchMutationResult>
  onRefreshGit?: () => void
  isRefreshingGit?: boolean
  onExecutionModeChange?: (mode: ExecutionMode) => Promise<void> | void
  onQualityPresetChange?: (preset: QualityPreset) => Promise<void> | void
  onToast?: (message: string) => void
}

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

const QUALITY_PRESET_LABEL: Record<QualityPreset, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}

export function Composer({
  onSend,
  onCancel,
  isLoading,
  disabled,
  model,
  onModelChange,
  settings,
  providerModels,
  projectPath,
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
  onExecutionModeChange,
  onQualityPresetChange,
  onToast,
}: ComposerProps): React.JSX.Element {
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<PreparedAttachment[]>([])
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false)
  const [branchMenuOpen, setBranchMenuOpen] = useState(false)
  const [branchQuery, setBranchQuery] = useState('')
  const [branchMessage, setBranchMessage] = useState<string | null>(null)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [isListening, setIsListening] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const qualityMenuRef = useRef<HTMLDivElement>(null)
  const branchMenuRef = useRef<HTMLDivElement>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)

  const isSandbox = settings.executionMode === 'sandbox'
  const canSend = (!!input.trim() || attachments.length > 0) && !disabled

  const filteredBranches = useMemo(() => {
    const query = branchQuery.trim().toLowerCase()
    const branches = gitBranches?.branches ?? []
    if (!query) return branches
    return branches.filter((branch) => branch.name.toLowerCase().includes(query))
  }, [branchQuery, gitBranches])
  const localBranches = useMemo(
    () => filteredBranches.filter((branch) => !branch.isRemote),
    [filteredBranches],
  )
  const remoteBranches = useMemo(
    () => filteredBranches.filter((branch) => branch.isRemote),
    [filteredBranches],
  )

  useEffect(() => {
    if (!isLoading && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [isLoading])

  useEffect(() => {
    if (!qualityMenuOpen) return
    function onMouseDown(event: MouseEvent): void {
      if (qualityMenuRef.current && !qualityMenuRef.current.contains(event.target as Node)) {
        setQualityMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [qualityMenuOpen])

  useEffect(() => {
    if (!branchMenuOpen) return
    function onMouseDown(event: MouseEvent): void {
      if (branchMenuRef.current && !branchMenuRef.current.contains(event.target as Node)) {
        setBranchMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [branchMenuOpen])

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop()
    }
  }, [])

  function resetComposerState(): void {
    setInput('')
    setAttachments([])
    setAttachmentError(null)
    setVoiceError(null)
    setBranchMessage(null)
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  function handleSubmit(): void {
    const payload: AgentSendPayload = {
      text: input.trim(),
      qualityPreset: settings.qualityPreset,
      attachments,
    }
    if ((!payload.text && payload.attachments.length === 0) || isLoading || disabled) return
    onSend(payload)
    resetComposerState()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>): void {
    setInput(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }

  async function handleAttachFiles(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const files = Array.from(event.target.files ?? [])
    const paths = files
      .map((file) => (file as File & { path?: string }).path)
      .filter((filePath): filePath is string => typeof filePath === 'string' && filePath.length > 0)
    event.target.value = ''

    if (!projectPath) {
      setAttachmentError('Select a project before attaching files.')
      return
    }
    if (paths.length === 0) return

    const remainingSlots = Math.max(0, 5 - attachments.length)
    if (remainingSlots === 0) {
      setAttachmentError('You can attach up to 5 files per message.')
      return
    }
    if (paths.length > remainingSlots) {
      setAttachmentError(
        `You can add ${String(remainingSlots)} more file${remainingSlots === 1 ? '' : 's'} in this message.`,
      )
      return
    }

    try {
      setAttachmentError(null)
      const prepared = await api.prepareAttachments(projectPath, paths)
      setAttachments((prev) => [...prev, ...prepared])
      onToast?.(`Attached ${String(prepared.length)} file${prepared.length === 1 ? '' : 's'}.`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to prepare attachments.'
      setAttachmentError(message)
      onToast?.(message)
    }
  }

  function removeAttachment(id: string): void {
    setAttachments((prev) => prev.filter((entry) => entry.id !== id))
  }

  async function handleExecutionModeChange(mode: ExecutionMode): Promise<void> {
    if (mode === settings.executionMode) return
    if (mode === 'full-access' && settings.executionMode === 'sandbox') {
      const confirmed = window.confirm(
        'Switching to Full access allows write/edit/command tools. Continue?',
      )
      if (!confirmed) return
    }
    await onExecutionModeChange?.(mode)
  }

  async function handleQualityChange(preset: QualityPreset): Promise<void> {
    setQualityMenuOpen(false)
    if (preset === settings.qualityPreset) return
    await onQualityPresetChange?.(preset)
  }

  async function runBranchMutation(run: () => Promise<GitBranchMutationResult>): Promise<void> {
    setBranchMessage(null)
    const result = await run()
    setBranchMessage(result.message)
    onToast?.(result.message)
  }

  async function handleBranchCreate(): Promise<void> {
    if (!onCreateBranch) return
    const name = window.prompt('New branch name')
    if (!name) return
    await runBranchMutation(() => onCreateBranch(name.trim(), undefined, true))
  }

  async function handleBranchRename(): Promise<void> {
    if (!onRenameBranch || !gitBranch) return
    const target = window.prompt(`Rename branch "${gitBranch}" to:`)
    if (!target) return
    await runBranchMutation(() => onRenameBranch(gitBranch, target.trim()))
  }

  async function handleBranchDelete(): Promise<void> {
    if (!onDeleteBranch || !gitBranch) return
    const confirmed = window.confirm(`Delete branch "${gitBranch}"?`)
    if (!confirmed) return
    await runBranchMutation(() => onDeleteBranch(gitBranch, false))
  }

  async function handleSetUpstream(): Promise<void> {
    if (!onSetBranchUpstream || !gitBranch) return
    const upstream = window.prompt(`Set upstream for "${gitBranch}" (example: origin/${gitBranch})`)
    if (!upstream) return
    await runBranchMutation(() => onSetBranchUpstream(gitBranch, upstream.trim()))
  }

  async function handleBranchCheckout(name: string): Promise<void> {
    if (!onCheckoutBranch) return
    await runBranchMutation(() => onCheckoutBranch(name))
    setBranchMenuOpen(false)
  }

  function startVoiceCapture(): void {
    const ctor =
      (
        window as Window & {
          SpeechRecognition?: SpeechRecognitionCtor
          webkitSpeechRecognition?: SpeechRecognitionCtor
        }
      ).SpeechRecognition ??
      (
        window as Window & {
          SpeechRecognition?: SpeechRecognitionCtor
          webkitSpeechRecognition?: SpeechRecognitionCtor
        }
      ).webkitSpeechRecognition

    if (!ctor) {
      setVoiceError('Voice input is not available on this system. Continue typing.')
      return
    }

    const recognition = new ctor()
    recognition.lang = 'en-US'
    recognition.continuous = false
    recognition.interimResults = false
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .flatMap((result) => Array.from(result))
        .map((alt) => alt.transcript)
        .join(' ')
        .trim()
      if (!transcript) return
      setInput((prev) => {
        const next = [prev.trim(), transcript].filter(Boolean).join(' ')
        return next
      })
    }
    recognition.onerror = (event) => {
      setVoiceError(`Voice input unavailable: ${event.error}. Continue typing.`)
      setIsListening(false)
    }
    recognition.onend = () => setIsListening(false)
    recognitionRef.current = recognition
    setVoiceError(null)
    setIsListening(true)
    recognition.start()
  }

  function handleVoiceToggle(): void {
    if (isListening) {
      recognitionRef.current?.stop()
      setIsListening(false)
      return
    }
    startVoiceCapture()
  }

  return (
    <div className="shrink-0">
      <output aria-live="polite" className="sr-only">
        {isLoading ? 'Agent is working' : ''}
      </output>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          void handleAttachFiles(event)
        }}
      />

      <div
        className={cn(
          'rounded-xl bg-bg-secondary border transition-shadow',
          'border-input-card-border',
          'has-[:focus]:border-accent/50 has-[:focus]:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-accent)_18%,transparent)]',
        )}
      >
        <div className="px-4 pt-3">
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {attachments.map((attachment) => (
                <span
                  key={attachment.id}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg px-2 py-1 text-[12px] text-text-secondary"
                >
                  <span className="max-w-[190px] truncate">{attachment.name}</span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(attachment.id)}
                    className="text-text-tertiary transition-colors hover:text-text-primary"
                    title={`Remove ${attachment.name}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          {(attachmentError || voiceError || branchMessage) && (
            <div className="mb-2 rounded-md border border-border bg-bg px-2.5 py-1.5 text-[12px] text-text-secondary">
              {attachmentError ?? voiceError ?? branchMessage}
            </div>
          )}
        </div>

        <div className="h-[60px] px-4 py-[14px]">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            aria-label="Message input"
            placeholder={isLoading ? 'Agent is working...' : 'Ask for follow-up changes'}
            disabled={isLoading || disabled}
            rows={1}
            className={cn(
              'w-full h-full resize-none bg-transparent text-[15px] text-text-primary',
              'placeholder:text-text-tertiary',
              'focus:outline-none focus-visible:shadow-none',
              'disabled:opacity-50',
            )}
          />
        </div>

        <div className="flex items-center justify-between h-11 px-4">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={!projectPath}
              className={cn(
                'flex items-center justify-center h-6 w-6 rounded-md border border-button-border text-text-tertiary transition-colors',
                projectPath
                  ? 'hover:bg-bg-hover hover:text-text-secondary'
                  : 'cursor-not-allowed opacity-60',
              )}
              title={projectPath ? 'Attach files' : 'Select a project first'}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>

            <ModelSelector
              value={model}
              onChange={onModelChange}
              settings={settings}
              providerModels={providerModels}
            />

            <div ref={qualityMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setQualityMenuOpen((prev) => !prev)}
                className="flex items-center gap-[5px] h-[26px] px-2.5 rounded-md border border-button-border transition-colors hover:bg-bg-hover"
                title="Select quality preset"
              >
                <span className="text-[12px] text-text-secondary">
                  {QUALITY_PRESET_LABEL[settings.qualityPreset]}
                </span>
                <span className="text-[9px] text-text-tertiary">&#x2228;</span>
              </button>
              {qualityMenuOpen && (
                <div className="absolute left-0 top-full z-20 mt-1 min-w-[140px] rounded-lg border border-border-light bg-bg-secondary py-1 shadow-lg">
                  {(['low', 'medium', 'high'] as const).map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        void handleQualityChange(preset)
                      }}
                      className={cn(
                        'flex w-full items-center justify-between px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-bg-hover',
                        settings.qualityPreset === preset ? 'text-accent' : 'text-text-secondary',
                      )}
                    >
                      <span>{QUALITY_PRESET_LABEL[preset]}</span>
                      {settings.qualityPreset === preset && <span>•</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleVoiceToggle}
              className={cn(
                'flex items-center justify-center h-5 w-5 transition-colors',
                isListening ? 'text-accent' : 'text-text-secondary hover:text-text-primary',
              )}
              title={isListening ? 'Stop voice input' : 'Start voice input'}
            >
              <Mic className="h-[15px] w-[15px]" />
            </button>

            {isLoading ? (
              <button
                type="button"
                onClick={onCancel}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-error/35 bg-error/10 text-error transition-colors hover:bg-error/18"
                title="Cancel"
              >
                <Square className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSend}
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full transition-colors',
                  canSend
                    ? 'bg-gradient-to-b from-accent to-accent-dim'
                    : 'border border-border bg-bg-tertiary cursor-not-allowed',
                )}
                title="Send message"
              >
                <ArrowUp className={cn('h-4 w-4', canSend ? 'text-bg' : 'text-text-muted')} />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between h-9 px-4 border-t border-border">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                void handleExecutionModeChange('sandbox')
              }}
              className={cn(
                'flex items-center gap-1 h-6 px-2 rounded-[5px] border text-[12px] transition-colors',
                isSandbox
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-border text-text-secondary hover:bg-bg-hover',
              )}
              title="Run with sandbox restrictions"
            >
              Sandbox
            </button>

            <button
              type="button"
              onClick={() => {
                void handleExecutionModeChange('full-access')
              }}
              className={cn(
                'flex items-center gap-1 h-6 px-2 rounded-[5px] border text-[12px] transition-colors',
                !isSandbox
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-border text-text-secondary hover:bg-bg-hover',
              )}
              title="Run with full tool access"
            >
              Full access
            </button>
          </div>

          <div className="flex items-center gap-2">
            {projectPath && (
              <>
                <div ref={branchMenuRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setBranchMenuOpen((prev) => !prev)}
                    className="flex items-center gap-1 h-6 px-2 rounded-[5px] border border-border text-[12px] text-text-secondary transition-colors hover:bg-bg-hover"
                    title="Manage branches"
                  >
                    <GitBranch className="h-[13px] w-[13px] text-text-tertiary" />
                    <span>{gitBranch ?? 'branch'}</span>
                    <span className="text-[9px] text-text-tertiary">&#x2228;</span>
                  </button>

                  {branchMenuOpen && (
                    <div className="absolute right-0 top-full z-20 mt-1 w-[320px] rounded-xl border border-border-light bg-bg-secondary p-2 shadow-xl">
                      <div className="mb-2 flex items-center gap-1.5">
                        <input
                          value={branchQuery}
                          onChange={(event) => setBranchQuery(event.target.value)}
                          placeholder="Search branches"
                          className="h-8 flex-1 rounded-md border border-border bg-bg px-2 text-[12px] text-text-primary placeholder:text-text-tertiary focus:border-accent/50 focus:outline-none"
                        />
                        {isBranchActionRunning && (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                        )}
                      </div>
                      <div className="mb-2 flex flex-wrap gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            void handleBranchCreate()
                          }}
                          className="rounded-md border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-bg-hover"
                        >
                          Create
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void handleBranchRename()
                          }}
                          className="rounded-md border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-bg-hover"
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void handleBranchDelete()
                          }}
                          className="rounded-md border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-bg-hover"
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void handleSetUpstream()
                          }}
                          className="rounded-md border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-bg-hover"
                        >
                          Upstream
                        </button>
                      </div>
                      <div className="max-h-[220px] overflow-y-auto rounded-md border border-border bg-bg">
                        {filteredBranches.length === 0 ? (
                          <div className="px-2.5 py-2 text-[12px] text-text-tertiary">
                            No branches found.
                          </div>
                        ) : (
                          <>
                            {localBranches.length > 0 && (
                              <div>
                                <div className="border-b border-border px-2.5 py-1 text-[11px] uppercase tracking-wide text-text-muted">
                                  Local
                                </div>
                                {localBranches.map((branch) => (
                                  <button
                                    key={branch.fullName}
                                    type="button"
                                    onClick={() => {
                                      void handleBranchCheckout(branch.name)
                                    }}
                                    className={cn(
                                      'flex w-full items-center justify-between border-b border-border px-2.5 py-1.5 text-left text-[12px] transition-colors hover:bg-bg-hover last:border-b-0',
                                      branch.isCurrent ? 'text-accent' : 'text-text-secondary',
                                    )}
                                  >
                                    <span className="truncate">{branch.name}</span>
                                    {branch.isCurrent && <span>●</span>}
                                  </button>
                                ))}
                              </div>
                            )}
                            {remoteBranches.length > 0 && (
                              <div>
                                <div className="border-b border-border px-2.5 py-1 text-[11px] uppercase tracking-wide text-text-muted">
                                  Remote
                                </div>
                                {remoteBranches.map((branch) => (
                                  <button
                                    key={branch.fullName}
                                    type="button"
                                    onClick={() => {
                                      void handleBranchCheckout(branch.name)
                                    }}
                                    className={cn(
                                      'flex w-full items-center justify-between border-b border-border px-2.5 py-1.5 text-left text-[12px] transition-colors hover:bg-bg-hover last:border-b-0',
                                      branch.isCurrent ? 'text-accent' : 'text-text-secondary',
                                    )}
                                  >
                                    <span className="truncate">{branch.name}</span>
                                    {branch.isCurrent && <span>●</span>}
                                  </button>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  disabled={!onRefreshGit || !!isRefreshingGit}
                  onClick={onRefreshGit}
                  className={cn(
                    'flex h-5 w-5 items-center justify-center transition-colors',
                    !onRefreshGit || !!isRefreshingGit
                      ? 'cursor-not-allowed opacity-60'
                      : 'hover:text-text-secondary',
                  )}
                  title="Refresh git status"
                >
                  <RefreshCw
                    className={cn(
                      'h-3.5 w-3.5 text-text-tertiary',
                      isRefreshingGit && 'animate-spin',
                    )}
                  />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
