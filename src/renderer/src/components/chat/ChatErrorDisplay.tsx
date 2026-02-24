import { type AgentErrorInfo, classifyErrorMessage } from '@shared/types/errors'
import {
  AlertCircle,
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
import { api } from '@/lib/ipc'
import { clearLastAgentErrorInfo, getLastAgentErrorInfo } from '@/lib/ipc-connection-adapter'

interface ChatErrorDisplayProps {
  error: Error
  lastUserMessage: string | null
  dismissedError: string | null
  conversationId: string | null
  onDismiss: (message: string) => void
  onOpenSettings?: () => void
  onRetry?: (content: string) => void
}

function resolveErrorInfo(error: Error, conversationId: string | null): AgentErrorInfo {
  if (conversationId) {
    const stored = getLastAgentErrorInfo(conversationId)
    if (stored) return stored
  }
  return classifyErrorMessage(error.message)
}

export function ChatErrorDisplay({
  error,
  lastUserMessage,
  dismissedError,
  conversationId,
  onDismiss,
  onOpenSettings,
  onRetry,
}: ChatErrorDisplayProps): React.JSX.Element | null {
  const [copied, setCopied] = useState(false)
  const [showDetails, setShowDetails] = useState(false)

  if (dismissedError === error.message) return null

  const info = resolveErrorInfo(error, conversationId)
  const isAuthError = info.code === 'api-key-invalid'

  function handleCopy(): void {
    const text = `${info.userMessage}${info.suggestion ? `\n${info.suggestion}` : ''}\n\nRaw: ${info.message}`
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleDismiss(): void {
    if (conversationId) clearLastAgentErrorInfo(conversationId)
    onDismiss(error.message)
  }

  return (
    <div className="my-3 rounded-xl border border-error/25 bg-error/6 px-4 py-3">
      <div className="flex items-start gap-3">
        <AlertCircle className="h-4 w-4 shrink-0 text-error mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-error/90">{info.userMessage}</p>
          {info.suggestion && (
            <p className="text-[13px] text-text-tertiary mt-1">{info.suggestion}</p>
          )}
          {error.stack && (
            <div className="mt-1.5">
              <button
                type="button"
                onClick={() => setShowDetails(!showDetails)}
                className="flex items-center gap-1 text-[12px] text-text-tertiary hover:text-text-secondary transition-colors"
              >
                {showDetails ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                Show details
              </button>
              {showDetails && (
                <pre className="mt-1.5 max-h-40 overflow-auto rounded-md bg-bg/50 p-2 text-[11px] text-text-tertiary font-mono whitespace-pre-wrap break-all">
                  {error.stack}
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
                <Settings className="h-3 w-3" />
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
                <RefreshCw className="h-3 w-3" />
                Retry
              </button>
            )}
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 rounded-md bg-bg-hover px-2.5 py-1 text-[13px] font-medium text-text-tertiary hover:text-text-secondary transition-colors"
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            {!isAuthError && (
              <button
                type="button"
                onClick={() => {
                  api.openLogsDir().catch(() => {})
                }}
                className="flex items-center gap-1.5 rounded-md bg-bg-hover px-2.5 py-1 text-[13px] font-medium text-text-tertiary hover:text-text-secondary transition-colors"
              >
                <FolderOpen className="h-3 w-3" />
                Open Logs
              </button>
            )}
            <button
              type="button"
              onClick={handleDismiss}
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
}
