import { type AgentErrorInfo, classifyErrorMessage } from '@shared/types/errors'
import {
  AlertCircle,
  Bug,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FolderOpen,
  RefreshCw,
  Settings,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { clearLastAgentErrorInfo, getLastAgentErrorInfo } from '@/lib/agent-error-store'
import { api } from '@/lib/ipc'
import { createRendererLogger } from '@/lib/logger'
import { useUIStore } from '@/stores/ui-store'

const logger = createRendererLogger('chat')

const DELAY_MS = 2000

function formatErrorDetails(error: Error, info: AgentErrorInfo): string {
  const detailLines = [`Raw: ${info.message}`]
  if (info.code !== 'unknown') {
    detailLines.push(`Code: ${info.code}`)
  }

  const stackIsRendererCreatedTransportError = error.stack?.startsWith(`Error: ${info.message}`)
  if (error.stack && error.stack !== error.message && !stackIsRendererCreatedTransportError) {
    detailLines.push('', error.stack)
  }

  return detailLines.join('\n')
}

interface ChatErrorDisplayProps {
  error: Error
  lastUserMessage: string | null
  dismissedError: string | null
  sessionId: string | null
  onDismiss: (message: string) => void
  onOpenSettings?: () => void
  onRetry?: (content: string) => void
}

function resolveErrorInfo(error: Error, sessionId: string | null): AgentErrorInfo {
  if (sessionId) {
    const stored = getLastAgentErrorInfo(sessionId)
    if (stored) return stored
  }
  return classifyErrorMessage(error.message)
}

export function ChatErrorDisplay({
  error,
  lastUserMessage,
  dismissedError,
  sessionId,
  onDismiss,
  onOpenSettings,
  onRetry,
}: ChatErrorDisplayProps) {
  const openFeedbackModal = useUIStore((s) => s.openFeedbackModal)
  const [copied, setCopied] = useState(false)
  const [showDetails, setShowDetails] = useState(false)

  if (dismissedError === error.message) return null

  const info = resolveErrorInfo(error, sessionId)
  const isAuthError = info.code === 'api-key-invalid' || info.code === 'session-expired'
  const details = formatErrorDetails(error, info)

  function handleCopy(): void {
    const text = `${info.userMessage}${info.suggestion ? `\n${info.suggestion}` : ''}\n\nRaw: ${info.message}`
    api.copyToClipboard(text)
    setCopied(true)
    setTimeout(() => setCopied(false), DELAY_MS)
  }

  function handleDismiss(): void {
    if (sessionId) clearLastAgentErrorInfo(sessionId)
    onDismiss(error.message)
  }

  return (
    <div className="my-3 rounded-xl border border-error/25 bg-error/6 px-4 py-3">
      <div className="flex items-start gap-3">
        <AlertCircle className="size-4 shrink-0 text-error mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-error/90">{info.userMessage}</p>
          {info.suggestion && (
            <p className="text-[13px] text-text-tertiary mt-1">{info.suggestion}</p>
          )}
          {details && (
            <div className="mt-1.5">
              <button
                type="button"
                onClick={() => setShowDetails(!showDetails)}
                className="flex items-center gap-1 text-[12px] text-text-tertiary hover:text-text-secondary transition-colors"
              >
                {showDetails ? (
                  <ChevronDown className="size-3" />
                ) : (
                  <ChevronRight className="size-3" />
                )}
                Show details
              </button>
              {showDetails && (
                <pre className="mt-1.5 max-h-40 overflow-auto rounded-md bg-bg/50 p-2 text-[11px] text-text-tertiary font-mono whitespace-pre-wrap break-all">
                  {details}
                </pre>
              )}
            </div>
          )}
          <div className="flex gap-2 mt-2">
            {isAuthError && onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="flex items-center gap-1.5 rounded-md bg-accent/10 px-2.5 py-1 text-[13px] font-medium text-accent hover:bg-accent/20 transition-colors"
              >
                <Settings className="size-3" />
                Open Settings
              </button>
            )}
            {info.retryable && lastUserMessage && onRetry && (
              <button
                type="button"
                onClick={() => {
                  handleDismiss()
                  onRetry(lastUserMessage)
                }}
                className="flex items-center gap-1.5 rounded-md bg-error/10 px-2.5 py-1 text-[13px] font-medium text-error hover:bg-error/20 transition-colors"
              >
                <RefreshCw className="size-3" />
                Retry
              </button>
            )}
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 rounded-md bg-bg-hover px-2.5 py-1 text-[13px] font-medium text-text-tertiary hover:text-text-secondary transition-colors"
            >
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            {!isAuthError && (
              <button
                type="button"
                onClick={() => openFeedbackModal(info)}
                className="flex items-center gap-1.5 rounded-md bg-bg-hover px-2.5 py-1 text-[13px] font-medium text-text-tertiary hover:text-text-secondary transition-colors"
              >
                <Bug className="size-3" />
                Report
              </button>
            )}
            {!isAuthError && (
              <button
                type="button"
                onClick={() => {
                  api.openLogsDir().catch((err: unknown) => {
                    logger.warn('Failed to open logs directory', { error: String(err) })
                  })
                }}
                className="flex items-center gap-1.5 rounded-md bg-bg-hover px-2.5 py-1 text-[13px] font-medium text-text-tertiary hover:text-text-secondary transition-colors"
              >
                <FolderOpen className="size-3" />
                Open Logs
              </button>
            )}
            <button
              type="button"
              onClick={handleDismiss}
              className="flex items-center gap-1.5 rounded-md bg-bg-hover px-2.5 py-1 text-[13px] font-medium text-text-tertiary hover:text-text-secondary transition-colors"
            >
              <X className="size-3" />
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
