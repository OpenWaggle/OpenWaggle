import type { AgentErrorInfo } from '@shared/types/errors'
import type { FeedbackCategory, FeedbackPayload, GhCliStatus } from '@shared/types/feedback'
import { useEffect, useState } from 'react'
import { api } from '@/lib/ipc'
import { useUIStore } from '@/stores/ui-store'

const GH_NEW_ISSUE_URL = 'https://github.com/OpenWaggle/OpenWaggle/issues/new'

interface UseFeedbackReturn {
  // State
  ghStatus: GhCliStatus | null
  submitting: boolean
  error: string | null
  cooldownActive: boolean

  // Form fields
  title: string
  setTitle: (value: string) => void
  description: string
  setDescription: (value: string) => void
  category: FeedbackCategory
  setCategory: (value: FeedbackCategory) => void
  includeSystemInfo: boolean
  setIncludeSystemInfo: (value: boolean) => void
  includeLogs: boolean
  setIncludeLogs: (value: boolean) => void
  includeErrorContext: boolean
  setIncludeErrorContext: (value: boolean) => void
  includeLastMessage: boolean
  setIncludeLastMessage: (value: boolean) => void
  includeModelInfo: boolean
  setIncludeModelInfo: (value: boolean) => void

  // Actions
  submit: () => Promise<void>
  copyAndOpen: () => Promise<void>
}

export function useFeedback(
  errorContext: AgentErrorInfo | null,
  lastUserMessage: string | null,
  activeModel: string | null,
  activeProvider: string | null,
): UseFeedbackReturn {
  const showPersistentToast = useUIStore((s) => s.showPersistentToast)
  const showToast = useUIStore((s) => s.showToast)
  const closeFeedbackModal = useUIStore((s) => s.closeFeedbackModal)
  const cooldownActive = useUIStore((s) => s.feedbackCooldownActive)
  const startFeedbackCooldown = useUIStore((s) => s.startFeedbackCooldown)

  const [ghStatus, setGhStatus] = useState<GhCliStatus | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form fields
  const [title, setTitle] = useState(() => (errorContext ? errorContext.userMessage : ''))
  const [description, setDescription] = useState(() => {
    if (!errorContext) return ''
    const parts = [errorContext.message]
    if (errorContext.suggestion) parts.push(`\nSuggestion: ${errorContext.suggestion}`)
    return parts.join('')
  })
  const [category, setCategory] = useState<FeedbackCategory>('bug')
  const [includeSystemInfo, setIncludeSystemInfo] = useState(true)
  const [includeLogs, setIncludeLogs] = useState(true)
  const [includeErrorContext, setIncludeErrorContext] = useState(!!errorContext)
  const [includeLastMessage, setIncludeLastMessage] = useState(false)
  const [includeModelInfo, setIncludeModelInfo] = useState(true)

  useEffect(() => {
    const loadStatus = async (): Promise<void> => {
      const gh = await api.checkGhCli()
      setGhStatus(gh)
    }
    loadStatus().catch(() => {})
  }, [])

  function buildPayload(): FeedbackPayload {
    return {
      title,
      description,
      category,
      includeSystemInfo,
      includeLogs,
      includeErrorContext,
      includeLastMessage,
      includeModelInfo,
      lastUserMessage: lastUserMessage ?? undefined,
      lastErrorContext: errorContext ?? undefined,
      activeModel: activeModel ?? undefined,
      activeProvider: activeProvider ?? undefined,
    }
  }

  async function submit(): Promise<void> {
    if (cooldownActive || submitting) return
    setError(null)
    setSubmitting(true)

    try {
      const result = await api.submitFeedback(buildPayload())
      if (result.success) {
        showPersistentToast({
          message: 'Issue created successfully',
          variant: 'success',
          persistent: true,
          action: result.issueUrl ? { label: 'View on GitHub', url: result.issueUrl } : undefined,
        })
        closeFeedbackModal()
        startFeedbackCooldown()
      } else {
        setError(result.error ?? 'Failed to create issue.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.')
    } finally {
      setSubmitting(false)
    }
  }

  async function copyAndOpen(): Promise<void> {
    setError(null)
    try {
      const markdown = await api.generateFeedbackMarkdown(buildPayload())
      api.copyToClipboard(markdown)
      await api.openExternal(GH_NEW_ISSUE_URL)
      showToast('Issue body copied to clipboard')
      closeFeedbackModal()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to copy feedback.')
    }
  }

  return {
    ghStatus,
    submitting,
    error,
    cooldownActive,
    title,
    setTitle,
    description,
    setDescription,
    category,
    setCategory,
    includeSystemInfo,
    setIncludeSystemInfo,
    includeLogs,
    setIncludeLogs,
    includeErrorContext,
    setIncludeErrorContext,
    includeLastMessage,
    setIncludeLastMessage,
    includeModelInfo,
    setIncludeModelInfo,
    submit,
    copyAndOpen,
  }
}
