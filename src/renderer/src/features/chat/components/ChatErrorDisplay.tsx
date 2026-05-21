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
import {
  clearLastAgentErrorInfo,
  getLastAgentErrorInfo,
} from '@/features/chat/lib/agent-error-store'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import { Button } from '@/shared/ui/Button'
import { useUIStore } from '@/shell/ui-store'

const logger = createRendererLogger('chat')

const DELAY_MS = 2000

function formatErrorDetails(error: Error, info: AgentErrorInfo) {
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

function resolveErrorInfo(error: Error, sessionId: string | null) {
  if (sessionId) {
    const stored = getLastAgentErrorInfo(sessionId)
    if (stored) return stored
  }
  return classifyErrorMessage(error.message)
}

interface ChatErrorActionsProps {
  readonly info: AgentErrorInfo
  readonly isAuthError: boolean
  readonly copy: { readonly copied: boolean; readonly onCopy: () => void }
  readonly retry: {
    readonly lastUserMessage: string | null
    readonly onRetry?: (content: string) => void
    readonly onDismiss: () => void
  }
  readonly onOpenSettings?: () => void
  readonly onDismiss: () => void
  readonly onReport: () => void
}

function ChatErrorActions({
  info,
  isAuthError,
  copy,
  retry,
  onOpenSettings,
  onDismiss,
  onReport,
}: ChatErrorActionsProps) {
  return (
    <div className="flex gap-2 mt-2">
      {isAuthError && onOpenSettings && (
        <Button variant="accent" onClick={onOpenSettings}>
          <Settings className="size-3" />
          Open Settings
        </Button>
      )}
      {info.retryable && retry.lastUserMessage && retry.onRetry && (
        <Button
          variant="danger"
          onClick={() => {
            retry.onDismiss()
            retry.onRetry?.(retry.lastUserMessage ?? '')
          }}
        >
          <RefreshCw className="size-3" />
          Retry
        </Button>
      )}
      <Button variant="subtle" onClick={copy.onCopy}>
        {copy.copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        {copy.copied ? 'Copied' : 'Copy'}
      </Button>
      {!isAuthError && (
        <Button variant="subtle" onClick={onReport}>
          <Bug className="size-3" />
          Report
        </Button>
      )}
      {!isAuthError && <OpenLogsButton />}
      <Button variant="subtle" onClick={onDismiss}>
        <X className="size-3" />
        Dismiss
      </Button>
    </div>
  )
}

function OpenLogsButton() {
  return (
    <Button
      variant="subtle"
      onClick={() => {
        api.openLogsDir().catch((err: unknown) => {
          logger.warn('Failed to open logs directory', { error: String(err) })
        })
      }}
    >
      <FolderOpen className="size-3" />
      Open Logs
    </Button>
  )
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

  function handleCopy() {
    const text = `${info.userMessage}${info.suggestion ? `\n${info.suggestion}` : ''}\n\nRaw: ${info.message}`
    api.copyToClipboard(text)
    setCopied(true)
    setTimeout(() => setCopied(false), DELAY_MS)
  }

  function handleDismiss() {
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
              <Button variant="ghost" size="xs" onClick={() => setShowDetails(!showDetails)}>
                {showDetails ? (
                  <ChevronDown className="size-3" />
                ) : (
                  <ChevronRight className="size-3" />
                )}
                Show details
              </Button>
              {showDetails && (
                <pre className="mt-1.5 max-h-40 overflow-auto rounded-md bg-bg/50 p-2 text-[11px] text-text-tertiary font-mono whitespace-pre-wrap break-all">
                  {details}
                </pre>
              )}
            </div>
          )}
          <ChatErrorActions
            info={info}
            isAuthError={isAuthError}
            copy={{ copied, onCopy: handleCopy }}
            retry={{ lastUserMessage, onRetry, onDismiss: handleDismiss }}
            onOpenSettings={onOpenSettings}
            onDismiss={handleDismiss}
            onReport={() => openFeedbackModal(info)}
          />
        </div>
      </div>
    </div>
  )
}
