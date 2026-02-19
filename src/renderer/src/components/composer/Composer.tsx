import type { AgentSendPayload, PreparedAttachment } from '@shared/types/agent'
import type {
  GitBranchListResult,
  GitBranchMutationResult,
  GitBranchSetUpstreamPayload,
} from '@shared/types/git'
import type { ProviderInfo, SupportedModelId } from '@shared/types/llm'
import type { ExecutionMode, QualityPreset, Settings as SettingsType } from '@shared/types/settings'
import { VOICE_MODEL_TINY } from '@shared/types/voice'
import { ArrowUp, GitBranch, Loader2, Mic, Plus, RefreshCw, Square, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
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

const VOICE_CAPTURE_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'] as const
const WHISPER_TARGET_SAMPLE_RATE = 16_000
const VOICE_MAX_RECORDING_SECONDS = 90
const VOICE_WAVEFORM_BARS = 72
const VOICE_WAVEFORM_SHIFT_PER_SECOND = 2

const QUALITY_PRESET_LABEL: Record<QualityPreset, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}

const EXECUTION_MODE_LABEL: Record<ExecutionMode, string> = {
  sandbox: 'Default permissions',
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
          'This enables write/edit/command tools. Default permissions runs commands in a sandbox.',
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
  const [isTranscribingVoice, setIsTranscribingVoice] = useState(false)
  const [voiceElapsedSeconds, setVoiceElapsedSeconds] = useState(0)
  const [voiceWaveform, setVoiceWaveform] = useState<number[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const actionDialogInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const qualityMenuRef = useRef<HTMLDivElement>(null)
  const executionMenuRef = useRef<HTMLDivElement>(null)
  const branchMenuRef = useRef<HTMLDivElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const recordedChunksRef = useRef<Blob[]>([])
  const voiceAudioContextRef = useRef<AudioContext | null>(null)
  const voiceAnalyserRef = useRef<AnalyserNode | null>(null)
  const voiceTickTimerRef = useRef<number | null>(null)
  const voiceAutoStopTimerRef = useRef<number | null>(null)
  const voiceRecordingStartRef = useRef<number | null>(null)
  const voiceAutoSendRequestedRef = useRef(false)
  const canSend = (!!input.trim() || attachments.length > 0) && !disabled

  const branchQueryNormalized = branchQuery.trim().toLowerCase()
  const allBranches = gitBranches?.branches ?? []
  const filteredBranches =
    branchQueryNormalized.length > 0
      ? allBranches.filter((branch) => branch.name.toLowerCase().includes(branchQueryNormalized))
      : allBranches
  const localBranches = filteredBranches.filter((branch) => !branch.isRemote)
  const remoteBranches = filteredBranches.filter((branch) => branch.isRemote)
  const actionDialogConfig = actionDialog ? getActionDialogConfig(actionDialog, gitBranch) : null
  const actionDialogHasInput =
    actionDialog === 'create-branch' ||
    actionDialog === 'rename-branch' ||
    actionDialog === 'set-upstream'
  const isVoiceModeActive = isListening || isTranscribingVoice

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
      mediaRecorderRef.current?.stop()
      mediaRecorderRef.current = null
      if (voiceTickTimerRef.current !== null) {
        window.clearInterval(voiceTickTimerRef.current)
        voiceTickTimerRef.current = null
      }
      if (voiceAutoStopTimerRef.current !== null) {
        window.clearTimeout(voiceAutoStopTimerRef.current)
        voiceAutoStopTimerRef.current = null
      }
      voiceAnalyserRef.current = null
      voiceRecordingStartRef.current = null
      void voiceAudioContextRef.current?.close().catch(() => undefined)
      voiceAudioContextRef.current = null
      if (mediaStreamRef.current) {
        for (const track of mediaStreamRef.current.getTracks()) {
          track.stop()
        }
      }
      mediaStreamRef.current = null
      recordedChunksRef.current = []
      voiceAutoSendRequestedRef.current = false
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

  function submitPayload(payload: AgentSendPayload): boolean {
    if ((!payload.text && payload.attachments.length === 0) || isLoading || disabled) return false
    onSend(payload)
    resetComposerState()
    return true
  }

  function handleSubmit(): void {
    submitPayload({
      text: input.trim(),
      qualityPreset: settings.qualityPreset,
      attachments,
    })
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

  function formatVoiceDuration(totalSeconds: number): string {
    const seconds = Math.max(0, Math.floor(totalSeconds))
    const minutesPart = Math.floor(seconds / 60)
    const secondsPart = seconds % 60
    return `${String(minutesPart)}:${String(secondsPart).padStart(2, '0')}`
  }

  function stopVoiceMeter(): void {
    if (voiceTickTimerRef.current !== null) {
      window.clearInterval(voiceTickTimerRef.current)
      voiceTickTimerRef.current = null
    }
    if (voiceAutoStopTimerRef.current !== null) {
      window.clearTimeout(voiceAutoStopTimerRef.current)
      voiceAutoStopTimerRef.current = null
    }
    voiceAnalyserRef.current = null
    voiceRecordingStartRef.current = null
    void voiceAudioContextRef.current?.close().catch(() => undefined)
    voiceAudioContextRef.current = null
    setVoiceElapsedSeconds(0)
    setVoiceWaveform([])
  }

  function cleanupVoiceStream(): void {
    stopVoiceMeter()
    if (!mediaStreamRef.current) return
    for (const track of mediaStreamRef.current.getTracks()) {
      track.stop()
    }
    mediaStreamRef.current = null
  }

  function sampleVoiceLevel(): number {
    const analyser = voiceAnalyserRef.current
    if (!analyser) return 0.08

    const waveformData = new Uint8Array(analyser.fftSize)
    analyser.getByteTimeDomainData(waveformData)

    let sumSquares = 0
    for (let index = 0; index < waveformData.length; index += 1) {
      const normalized = (waveformData[index] - 128) / 128
      sumSquares += normalized * normalized
    }
    const rms = Math.sqrt(sumSquares / waveformData.length)
    return Math.max(0.08, Math.min(1, rms * 3.5))
  }

  async function startVoiceMeter(stream: MediaStream): Promise<void> {
    const context = new AudioContext()
    const source = context.createMediaStreamSource(stream)
    const analyser = context.createAnalyser()
    analyser.fftSize = 1024
    analyser.smoothingTimeConstant = 0.6
    source.connect(analyser)

    voiceAudioContextRef.current = context
    voiceAnalyserRef.current = analyser
    voiceRecordingStartRef.current = Date.now()
    setVoiceElapsedSeconds(0)
    setVoiceWaveform(
      Array.from({ length: VOICE_WAVEFORM_BARS }, (_, index) =>
        index % 3 === 0 ? 0.2 : index % 2 === 0 ? 0.12 : 0.08,
      ),
    )

    voiceTickTimerRef.current = window.setInterval(() => {
      if (!voiceRecordingStartRef.current) return
      const elapsed = Math.floor((Date.now() - voiceRecordingStartRef.current) / 1000)
      setVoiceElapsedSeconds(elapsed)

      const level = sampleVoiceLevel()
      const generated = Array.from({ length: VOICE_WAVEFORM_SHIFT_PER_SECOND }, (_entry, index) => {
        const variance = (Math.random() - 0.5) * 0.12
        const offset = index % 2 === 0 ? 0.03 : -0.02
        return Math.max(0.08, Math.min(1, level + variance + offset))
      })
      setVoiceWaveform((prev) => {
        const baseline =
          prev.length > 0 ? prev : Array.from({ length: VOICE_WAVEFORM_BARS }, () => 0.08)
        return [...baseline.slice(generated.length), ...generated]
      })
    }, 1000)

    voiceAutoStopTimerRef.current = window.setTimeout(() => {
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop()
      }
    }, VOICE_MAX_RECORDING_SECONDS * 1000)
  }

  function downsampleAudio(
    samples: Float32Array,
    sourceRate: number,
    targetRate: number,
  ): Float32Array {
    if (sourceRate === targetRate) {
      return new Float32Array(samples)
    }
    const ratio = sourceRate / targetRate
    const outputLength = Math.max(1, Math.round(samples.length / ratio))
    const output = new Float32Array(outputLength)
    for (let index = 0; index < outputLength; index += 1) {
      const sourceIndex = index * ratio
      const lower = Math.floor(sourceIndex)
      const upper = Math.min(samples.length - 1, lower + 1)
      const blend = sourceIndex - lower
      output[index] = samples[lower] * (1 - blend) + samples[upper] * blend
    }
    return output
  }

  function toMono(buffer: AudioBuffer): Float32Array {
    if (buffer.numberOfChannels === 1) {
      return new Float32Array(buffer.getChannelData(0))
    }

    const mono = new Float32Array(buffer.length)
    const channelWeight = 1 / buffer.numberOfChannels
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel)
      for (let index = 0; index < data.length; index += 1) {
        mono[index] += data[index] * channelWeight
      }
    }
    return mono
  }

  async function decodeRecordedAudio(blob: Blob): Promise<Float32Array> {
    const audioContext = new AudioContext()
    try {
      const arrayBuffer = await blob.arrayBuffer()
      const decoded = await audioContext.decodeAudioData(arrayBuffer)
      const mono = toMono(decoded)
      return downsampleAudio(mono, decoded.sampleRate, WHISPER_TARGET_SAMPLE_RATE)
    } finally {
      await audioContext.close().catch(() => undefined)
    }
  }

  function trimSilence(
    samples: Float32Array,
    sampleRate: number,
    threshold = 0.012,
    paddingMs = 160,
  ): Float32Array {
    if (samples.length === 0) return samples

    let start = 0
    while (start < samples.length && Math.abs(samples[start]) < threshold) {
      start += 1
    }

    let end = samples.length - 1
    while (end > start && Math.abs(samples[end]) < threshold) {
      end -= 1
    }

    if (start >= end) return samples
    const paddingSamples = Math.round((paddingMs / 1000) * sampleRate)
    const paddedStart = Math.max(0, start - paddingSamples)
    const paddedEnd = Math.min(samples.length, end + paddingSamples)
    return samples.slice(paddedStart, paddedEnd)
  }

  function toPcm16(samples: Float32Array): Uint8Array {
    const bytes = new Uint8Array(samples.length * 2)
    const view = new DataView(bytes.buffer)
    for (let index = 0; index < samples.length; index += 1) {
      const value = Math.max(-1, Math.min(1, samples[index]))
      const scaled = value < 0 ? Math.round(value * 32768) : Math.round(value * 32767)
      view.setInt16(index * 2, scaled, true)
    }
    return bytes
  }

  async function transcribeRecordedChunks(chunks: Blob[]): Promise<void> {
    if (chunks.length === 0) {
      setVoiceError('No speech detected. Try again or continue typing.')
      return
    }

    setIsTranscribingVoice(true)
    setVoiceError(null)

    try {
      const blob = new Blob(chunks, { type: chunks[0].type || 'audio/webm' })
      const decodedSamples = await decodeRecordedAudio(blob)
      const trimmedSamples = trimSilence(decodedSamples, WHISPER_TARGET_SAMPLE_RATE)
      if (trimmedSamples.length === 0) {
        setVoiceError('No speech detected. Try again or continue typing.')
        return
      }
      const pcm16 = toPcm16(trimmedSamples)

      const result = await api.transcribeVoiceLocal({
        pcm16,
        sampleRate: WHISPER_TARGET_SAMPLE_RATE,
        language: 'en',
        model: VOICE_MODEL_TINY,
      })

      if (!result.text.trim()) {
        voiceAutoSendRequestedRef.current = false
        setVoiceError('No speech detected. Try again or continue typing.')
        return
      }

      const transcript = result.text.trim()
      const autoSend = voiceAutoSendRequestedRef.current
      voiceAutoSendRequestedRef.current = false

      if (autoSend) {
        const composedText = [input.trim(), transcript].filter(Boolean).join(' ')
        const submitted = submitPayload({
          text: composedText,
          qualityPreset: settings.qualityPreset,
          attachments,
        })
        if (!submitted) {
          insertTranscriptAtCursor(transcript)
        }
      } else {
        insertTranscriptAtCursor(transcript)
      }
      setVoiceError(null)
    } catch (error) {
      voiceAutoSendRequestedRef.current = false
      const message =
        error instanceof Error
          ? error.message
          : 'Voice input is unavailable in this environment. Continue by typing your prompt.'
      setVoiceError(message)
    } finally {
      setIsTranscribingVoice(false)
    }
  }

  async function startVoiceCapture(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setVoiceError(
        'Voice capture is unavailable in this environment. Continue by typing your prompt.',
      )
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream
      recordedChunksRef.current = []
      voiceAutoSendRequestedRef.current = false

      const mimeType = VOICE_CAPTURE_MIME_TYPES.find((candidate) =>
        MediaRecorder.isTypeSupported(candidate),
      )

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)
      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size === 0) return
        recordedChunksRef.current.push(event.data)
      }
      recorder.onerror = () => {
        setIsListening(false)
        setVoiceError('Unable to record audio. Continue by typing your prompt.')
        mediaRecorderRef.current = null
        recordedChunksRef.current = []
        cleanupVoiceStream()
      }
      recorder.onstop = () => {
        setIsListening(false)
        mediaRecorderRef.current = null
        const chunks = [...recordedChunksRef.current]
        recordedChunksRef.current = []
        cleanupVoiceStream()
        void transcribeRecordedChunks(chunks)
      }

      mediaRecorderRef.current = recorder
      setVoiceError(null)
      recorder.start()
      setIsListening(true)
      await startVoiceMeter(stream)
    } catch {
      cleanupVoiceStream()
      setIsListening(false)
      setVoiceError('Microphone permission is blocked. Continue by typing your prompt.')
    }
  }

  function handleVoiceSend(): void {
    if (isTranscribingVoice) return
    if (isListening) {
      voiceAutoSendRequestedRef.current = true
      mediaRecorderRef.current?.stop()
      return
    }
    handleSubmit()
  }

  function handleVoiceToggle(): void {
    if (isTranscribingVoice) return
    if (isListening) {
      mediaRecorderRef.current?.stop()
      return
    }
    void startVoiceCapture()
  }

  useEffect(() => {
    if (!isVoiceModeActive) return
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Enter' || event.shiftKey) return
      event.preventDefault()
      if (isTranscribingVoice) return
      if (isListening) {
        voiceAutoSendRequestedRef.current = true
        mediaRecorderRef.current?.stop()
        return
      }
      if (isLoading || disabled) return
      const text = input.trim()
      if (!text && attachments.length === 0) return
      onSend({
        text,
        qualityPreset: settings.qualityPreset,
        attachments,
      })
      setInput('')
      setAttachments([])
      setAttachmentError(null)
      setVoiceError(null)
      setBranchMessage(null)
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [
    isVoiceModeActive,
    isListening,
    isTranscribingVoice,
    isLoading,
    disabled,
    input,
    attachments,
    onSend,
    settings.qualityPreset,
  ])

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

        {isVoiceModeActive ? (
          <div className="h-[60px] px-4 py-[12px]">
            <div className="flex h-full items-center gap-3 rounded-lg border border-border bg-bg px-2.5">
              <button
                type="button"
                className="flex items-center justify-center h-6 w-6 text-text-tertiary/90 transition-colors hover:text-text-primary"
                title="Attach files"
                disabled
              >
                <Plus className="h-3.5 w-3.5" />
              </button>

              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div className="relative flex h-8 flex-1 items-center gap-[2px] overflow-hidden">
                  <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 border-t border-dashed border-text-tertiary/55" />
                  {isListening ? (
                    voiceWaveform.map((level, index) => (
                      <span
                        key={`voice-wave-${String(index)}`}
                        className="relative z-10 inline-flex h-full items-center"
                      >
                        <span
                          className="w-[3px] rounded-[2px] bg-text-primary/95"
                          style={{
                            height: `${String(Math.max(4, Math.round(level * 28)))}px`,
                            opacity: Math.max(0.35, level),
                            transition: 'height 800ms ease, opacity 800ms ease',
                          }}
                        />
                      </span>
                    ))
                  ) : (
                    <div className="relative z-10 flex items-center gap-2 text-[12px] text-text-secondary">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Transcribing locally...</span>
                    </div>
                  )}
                </div>
                <span className="w-10 text-right text-[12px] tabular-nums text-text-tertiary">
                  {isListening ? formatVoiceDuration(voiceElapsedSeconds) : '...'}
                </span>
              </div>

              {isListening ? (
                <button
                  type="button"
                  onClick={() => mediaRecorderRef.current?.stop()}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-bg-tertiary text-text-primary transition-colors hover:bg-bg-hover"
                  title="Stop recording"
                >
                  <Square className="h-3.5 w-3.5" />
                </button>
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-bg-tertiary text-text-tertiary">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                </div>
              )}
              <button
                type="button"
                onClick={handleVoiceSend}
                disabled={isTranscribingVoice}
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full transition-colors',
                  isTranscribingVoice
                    ? 'border border-border bg-bg-tertiary cursor-not-allowed'
                    : 'bg-text-primary text-bg hover:bg-text-primary/90',
                )}
                title="Send recording"
              >
                <ArrowUp
                  className={cn('h-4 w-4', isTranscribingVoice ? 'text-text-muted' : 'text-bg')}
                />
              </button>
            </div>
          </div>
        ) : (
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
        )}

        {!isVoiceModeActive && (
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
                disabled={isTranscribingVoice}
                className={cn(
                  'flex items-center justify-center h-5 w-5 transition-colors',
                  isTranscribingVoice
                    ? 'cursor-not-allowed text-text-tertiary'
                    : isListening
                      ? 'text-accent'
                      : 'text-text-secondary hover:text-text-primary',
                )}
                title={
                  isTranscribingVoice
                    ? 'Transcribing audio'
                    : isListening
                      ? 'Stop voice input'
                      : 'Start voice input'
                }
              >
                {isTranscribingVoice ? (
                  <Loader2 className="h-[15px] w-[15px] animate-spin" />
                ) : (
                  <Mic className="h-[15px] w-[15px]" />
                )}
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
        )}

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
