import { AlertCircle, RefreshCw, Settings, X } from 'lucide-react'

interface ChatErrorDisplayProps {
  error: Error
  lastUserMessage: string | null
  dismissedError: string | null
  onDismiss: (message: string) => void
  onOpenSettings?: () => void
  onRetry?: (content: string) => void
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

export function ChatErrorDisplay({
  error,
  lastUserMessage,
  dismissedError,
  onDismiss,
  onOpenSettings,
  onRetry,
}: ChatErrorDisplayProps): React.JSX.Element | null {
  if (dismissedError === error.message) return null

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
                  onDismiss(error.message)
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
              onClick={() => onDismiss(error.message)}
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
