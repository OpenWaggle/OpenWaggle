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
  processLocally?: boolean
  onstart: (() => void) | null
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

const EXECUTION_MODE_LABEL: Record<ExecutionMode, string> = {
  sandbox: 'Sandbox',
  'full-access': 'Full access',
}

type ComposerActionDialogKind =
  | 'create-branch'
  | 'rename-branch'
  | 'delete-branch'
  | 'set-upstream'
  | 'confirm-full-access'

interface ComposerActionDialogConfig {
  title: string
  description: string
  confirmLabel: string
  confirmTone: 'normal' | 'danger'
  inputPlaceholder?: string
}

function getActionDialogConfig(
  kind: ComposerActionDialogKind,
  gitBranch: string | null | undefined,
): ComposerActionDialogConfig {
  const currentBranch = gitBranch ?? 'current branch'
  switch (kind) {
    case 'create-branch':
      return {
        title: 'Create branch',
        description: 'Create and checkout a new branch from the current HEAD.',
        confirmLabel: 'Create',
        confirmTone: 'normal',
        inputPlaceholder: 'feature/my-branch',
      }
    case 'rename-branch':
      return {
        title: `Rename "${currentBranch}"`,
        description: 'Enter the new branch name.',
        confirmLabel: 'Rename',
        confirmTone: 'normal',
        inputPlaceholder: 'feature/new-name',
      }
    case 'delete-branch':
      return {
        title: `Delete "${currentBranch}"`,
        description: 'This removes the local branch. This action cannot be undone.',
        confirmLabel: 'Delete',
        confirmTone: 'danger',
      }
    case 'set-upstream':
      return {
        title: `Set upstream for "${currentBranch}"`,
        description: 'Enter the remote tracking branch (for example origin/main).',
        confirmLabel: 'Set upstream',
        confirmTone: 'normal',
        inputPlaceholder: `origin/${currentBranch}`,
      }
    case 'confirm-full-access':
      return {
        title: 'Switch to Full access',
        description:
          'This enables write/edit/command tools for agent runs. Continue only if you trust the workspace.',
        confirmLabel: 'Switch',
        confirmTone: 'danger',
      }
  }
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
  const [executionMenuOpen, setExecutionMenuOpen] = useState(false)
  const [branchMenuOpen, setBranchMenuOpen] = useState(false)
  const [actionDialog, setActionDialog] = useState<ComposerActionDialogKind | null>(null)
  const [actionDialogInput, setActionDialogInput] = useState('')
  const [actionDialogError, setActionDialogError] = useState<string | null>(null)
  const [actionDialogBusy, setActionDialogBusy] = useState(false)
  const [branchQuery, setBranchQuery] = useState('')
  const [branchMessage, setBranchMessage] = useState<string | null>(null)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [isListening, setIsListening] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const actionDialogInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const qualityMenuRef = useRef<HTMLDivElement>(null)
  const executionMenuRef = useRef<HTMLDivElement>(null)
  const branchMenuRef = useRef<HTMLDivElement>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const voiceNetworkUnavailableRef = useRef(false)
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
  const actionDialogConfig = actionDialog ? getActionDialogConfig(actionDialog, gitBranch) : null
  const actionDialogHasInput =
    actionDialog === 'create-branch' ||
    actionDialog === 'rename-branch' ||
    actionDialog === 'set-upstream'

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
    if (!executionMenuOpen) return
    function onMouseDown(event: MouseEvent): void {
      if (executionMenuRef.current && !executionMenuRef.current.contains(event.target as Node)) {
        setExecutionMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [executionMenuOpen])

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
    if (!actionDialog) return
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return
      if (actionDialogBusy) return
      event.preventDefault()
      setActionDialog(null)
      setActionDialogInput('')
      setActionDialogError(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [actionDialog, actionDialogBusy])

  useEffect(() => {
    if (!actionDialogHasInput) return
    requestAnimationFrame(() => {
      actionDialogInputRef.current?.focus()
    })
  }, [actionDialogHasInput])

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

  function openActionDialog(kind: ComposerActionDialogKind, initialValue = ''): void {
    setQualityMenuOpen(false)
    setExecutionMenuOpen(false)
    setBranchMenuOpen(false)
    setActionDialog(kind)
    setActionDialogInput(initialValue)
    setActionDialogError(null)
  }

  function closeActionDialog(): void {
    if (actionDialogBusy) return
    setActionDialog(null)
    setActionDialogInput('')
    setActionDialogError(null)
  }

  async function handleExecutionModeChange(mode: ExecutionMode): Promise<void> {
    setExecutionMenuOpen(false)
    if (mode === settings.executionMode) return
    if (mode === 'full-access' && settings.executionMode === 'sandbox') {
      openActionDialog('confirm-full-access')
      return
    }
    await onExecutionModeChange?.(mode)
  }

  async function handleQualityChange(preset: QualityPreset): Promise<void> {
    setQualityMenuOpen(false)
    if (preset === settings.qualityPreset) return
    await onQualityPresetChange?.(preset)
  }

  async function runBranchMutation(
    run: () => Promise<GitBranchMutationResult>,
  ): Promise<GitBranchMutationResult> {
    setBranchMessage(null)
    try {
      const result = await run()
      setBranchMessage(result.message)
      onToast?.(result.message)
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Branch operation failed.'
      setBranchMessage(message)
      onToast?.(message)
      return {
        ok: false,
        code: 'unknown',
        message,
      }
    }
  }

  function handleBranchCreate(): void {
    if (!onCreateBranch) return
    openActionDialog('create-branch')
  }

  function handleBranchRename(): void {
    if (!onRenameBranch || !gitBranch) return
    openActionDialog('rename-branch', gitBranch)
  }

  function handleBranchDelete(): void {
    if (!onDeleteBranch || !gitBranch) return
    openActionDialog('delete-branch')
  }

  function handleSetUpstream(): void {
    if (!onSetBranchUpstream || !gitBranch) return
    openActionDialog('set-upstream', `origin/${gitBranch}`)
  }

  async function handleBranchCheckout(name: string): Promise<void> {
    if (!onCheckoutBranch) return
    const result = await runBranchMutation(() => onCheckoutBranch(name))
    if (result.ok) {
      setBranchMenuOpen(false)
    }
  }

  async function handleActionDialogConfirm(): Promise<void> {
    if (!actionDialog) return

    setActionDialogError(null)
    setActionDialogBusy(true)

    try {
      switch (actionDialog) {
        case 'confirm-full-access': {
          await onExecutionModeChange?.('full-access')
          setActionDialog(null)
          setActionDialogInput('')
          return
        }
        case 'create-branch': {
          if (!onCreateBranch) return
          const name = actionDialogInput.trim()
          if (!name) {
            setActionDialogError('Branch name is required.')
            return
          }
          const result = await runBranchMutation(() => onCreateBranch(name, undefined, true))
          if (!result.ok) {
            setActionDialogError(result.message)
            return
          }
          setActionDialog(null)
          setActionDialogInput('')
          return
        }
        case 'rename-branch': {
          if (!onRenameBranch || !gitBranch) return
          const target = actionDialogInput.trim()
          if (!target) {
            setActionDialogError('New branch name is required.')
            return
          }
          const result = await runBranchMutation(() => onRenameBranch(gitBranch, target))
          if (!result.ok) {
            setActionDialogError(result.message)
            return
          }
          setActionDialog(null)
          setActionDialogInput('')
          return
        }
        case 'delete-branch': {
          if (!onDeleteBranch || !gitBranch) return
          const result = await runBranchMutation(() => onDeleteBranch(gitBranch, false))
          if (!result.ok) {
            setActionDialogError(result.message)
            return
          }
          setActionDialog(null)
          setActionDialogInput('')
          return
        }
        case 'set-upstream': {
          if (!onSetBranchUpstream || !gitBranch) return
          const upstream = actionDialogInput.trim()
          if (!upstream) {
            setActionDialogError('Upstream branch is required.')
            return
          }
          const result = await runBranchMutation(() => onSetBranchUpstream(gitBranch, upstream))
          if (!result.ok) {
            setActionDialogError(result.message)
            return
          }
          setActionDialog(null)
          setActionDialogInput('')
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Action failed.'
      setActionDialogError(message)
    } finally {
      setActionDialogBusy(false)
    }
  }

  function insertTranscriptAtCursor(rawTranscript: string): void {
    const transcript = rawTranscript.trim()
    if (!transcript) return

    const textarea = textareaRef.current
    if (!textarea) {
      setInput((prev) => [prev.trim(), transcript].filter(Boolean).join(' '))
      return
    }

    const selectionStart = textarea.selectionStart ?? textarea.value.length
    const selectionEnd = textarea.selectionEnd ?? textarea.value.length

    setInput((prev) => {
      const before = prev.slice(0, selectionStart)
      const after = prev.slice(selectionEnd)
      const needsLeadingSpace = before.length > 0 && !/\s$/.test(before)
      const needsTrailingSpace = after.length > 0 && !/^\s/.test(after)
      const inserted = `${needsLeadingSpace ? ' ' : ''}${transcript}${needsTrailingSpace ? ' ' : ''}`
      const next = `${before}${inserted}${after}`

      requestAnimationFrame(() => {
        const caret = selectionStart + inserted.length
        textarea.focus()
        textarea.setSelectionRange(caret, caret)
        textarea.style.height = 'auto'
        textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`
      })

      return next
    })
  }

  async function ensureMicrophoneAccess(): Promise<boolean> {
    if (!navigator.mediaDevices?.getUserMedia) return true
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      for (const track of stream.getTracks()) {
        track.stop()
      }
      return true
    } catch {
      setVoiceError('Microphone permission is blocked. Continue by typing your prompt.')
      return false
    }
  }

  function mapVoiceError(errorCode: string): string {
    switch (errorCode) {
      case 'not-allowed':
      case 'service-not-allowed':
        return 'Microphone permission was denied. Continue by typing your prompt.'
      case 'network':
        return 'Speech recognition service is unavailable in this environment. Continue by typing your prompt.'
      case 'no-speech':
        return 'No speech detected. Try again or continue typing.'
      default:
        return `Voice input unavailable (${errorCode}). Continue by typing your prompt.`
    }
  }

  async function startVoiceCapture(): Promise<void> {
    if (voiceNetworkUnavailableRef.current) {
      setVoiceError('Voice input is unavailable here. Continue by typing your prompt.')
      return
    }

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
      setVoiceError('Voice input is not available on this system. Continue by typing your prompt.')
      voiceNetworkUnavailableRef.current = true
      return
    }

    const hasMicrophoneAccess = await ensureMicrophoneAccess()
    if (!hasMicrophoneAccess) {
      return
    }

    const recognition = new ctor()
    recognition.lang = 'en-US'
    recognition.continuous = false
    recognition.interimResults = false
    recognition.processLocally = true
    recognition.onstart = () => setIsListening(true)
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .flatMap((result) => Array.from(result))
        .map((alt) => alt.transcript)
        .join(' ')
        .trim()
      if (!transcript) return
      insertTranscriptAtCursor(transcript)
    }
    recognition.onerror = (event) => {
      if (event.error === 'network') {
        voiceNetworkUnavailableRef.current = true
      }
      setVoiceError(mapVoiceError(event.error))
      setIsListening(false)
    }
    recognition.onend = () => setIsListening(false)
    recognitionRef.current?.stop()
    recognitionRef.current = recognition
    setVoiceError(null)
    try {
      recognition.start()
    } catch {
      setIsListening(false)
      setVoiceError('Unable to start voice input. Continue by typing your prompt.')
    }
  }

  function handleVoiceToggle(): void {
    if (isListening) {
      recognitionRef.current?.stop()
      setIsListening(false)
      return
    }
    void startVoiceCapture()
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
          {([attachmentError, voiceError, branchMessage].some(Boolean) && (
            <div className="mb-2 rounded-md border border-border bg-bg px-2.5 py-1.5 text-[12px] text-text-secondary">
              {[attachmentError, voiceError, branchMessage]
                .filter((message): message is string => Boolean(message))
                .map((message) => (
                  <div key={message}>{message}</div>
                ))}
            </div>
          )) ||
            null}
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
                onClick={() => {
                  setExecutionMenuOpen(false)
                  setBranchMenuOpen(false)
                  setQualityMenuOpen((prev) => !prev)
                }}
                className="flex items-center gap-[5px] h-[26px] px-2.5 rounded-md border border-button-border transition-colors hover:bg-bg-hover"
                title="Select quality preset"
              >
                <span className="text-[12px] text-text-secondary">
                  {QUALITY_PRESET_LABEL[settings.qualityPreset]}
                </span>
                <span className="text-[9px] text-text-tertiary">&#x2228;</span>
              </button>
              {qualityMenuOpen && (
                <div className="absolute bottom-full left-0 z-30 mb-1 min-w-[140px] rounded-lg border border-border-light bg-bg-secondary py-1 shadow-lg">
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
            <div ref={executionMenuRef} className="relative">
              <button
                type="button"
                onClick={() => {
                  setQualityMenuOpen(false)
                  setBranchMenuOpen(false)
                  setExecutionMenuOpen((prev) => !prev)
                }}
                className="flex items-center gap-[5px] h-6 px-2 rounded-[5px] border border-border text-[12px] text-text-secondary transition-colors hover:bg-bg-hover"
                title="Select execution mode"
              >
                <span>{EXECUTION_MODE_LABEL[settings.executionMode]}</span>
                <span className="text-[9px] text-text-tertiary">&#x2228;</span>
              </button>

              {executionMenuOpen && (
                <div className="absolute bottom-full left-0 z-30 mb-1 min-w-[150px] rounded-lg border border-border-light bg-bg-secondary py-1 shadow-lg">
                  {(['sandbox', 'full-access'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => {
                        void handleExecutionModeChange(mode)
                      }}
                      className={cn(
                        'flex w-full items-center justify-between px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-bg-hover',
                        settings.executionMode === mode ? 'text-accent' : 'text-text-secondary',
                      )}
                    >
                      <span>{EXECUTION_MODE_LABEL[mode]}</span>
                      {settings.executionMode === mode && <span>•</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {projectPath && (
              <>
                <div ref={branchMenuRef} className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setExecutionMenuOpen(false)
                      setQualityMenuOpen(false)
                      setBranchMenuOpen((prev) => !prev)
                    }}
                    className="flex items-center gap-1 h-6 px-2 rounded-[5px] border border-border text-[12px] text-text-secondary transition-colors hover:bg-bg-hover"
                    title="Manage branches"
                  >
                    <GitBranch className="h-[13px] w-[13px] text-text-tertiary" />
                    <span>{gitBranch ?? 'branch'}</span>
                    <span className="text-[9px] text-text-tertiary">&#x2228;</span>
                  </button>

                  {branchMenuOpen && (
                    <div className="absolute bottom-full right-0 z-30 mb-1 w-[320px] rounded-xl border border-border-light bg-bg-secondary p-2 shadow-xl">
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
                            handleBranchCreate()
                          }}
                          className="rounded-md border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-bg-hover"
                        >
                          Create
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            handleBranchRename()
                          }}
                          className="rounded-md border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-bg-hover"
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            handleBranchDelete()
                          }}
                          className="rounded-md border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-bg-hover"
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            handleSetUpstream()
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

      {actionDialog && actionDialogConfig && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-[360px] rounded-xl border border-border-light bg-bg-secondary p-4 shadow-2xl">
            <h3 className="text-sm font-semibold text-text-primary">{actionDialogConfig.title}</h3>
            <p className="mt-1 text-[12px] text-text-tertiary">{actionDialogConfig.description}</p>

            {actionDialogConfig.inputPlaceholder && (
              <input
                ref={actionDialogInputRef}
                value={actionDialogInput}
                onChange={(event) => setActionDialogInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  void handleActionDialogConfirm()
                }}
                placeholder={actionDialogConfig.inputPlaceholder}
                className="mt-3 h-9 w-full rounded-md border border-border bg-bg px-2.5 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-accent/50 focus:outline-none"
              />
            )}

            {actionDialogError && (
              <div className="mt-3 rounded-md border border-error/30 bg-error/10 px-2.5 py-1.5 text-[12px] text-error">
                {actionDialogError}
              </div>
            )}

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeActionDialog}
                disabled={actionDialogBusy}
                className="h-8 rounded-md border border-border px-3 text-[12px] text-text-secondary transition-colors hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleActionDialogConfirm()
                }}
                disabled={actionDialogBusy}
                className={cn(
                  'h-8 rounded-md px-3 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                  actionDialogConfig.confirmTone === 'danger'
                    ? 'bg-error/20 text-error hover:bg-error/30'
                    : 'bg-accent/20 text-accent hover:bg-accent/30',
                )}
              >
                {actionDialogBusy ? 'Working...' : actionDialogConfig.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
