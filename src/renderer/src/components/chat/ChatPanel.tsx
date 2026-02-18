import type { UIMessage } from '@tanstack/ai-react'
import { AlertCircle, ChevronDown, Hexagon, RefreshCw, Settings, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Spinner } from '@/components/shared/Spinner'
import { projectName } from '@/lib/format'
import { MessageBubble } from './MessageBubble'

interface ChatPanelProps {
  messages: UIMessage[]
  isLoading: boolean
  error: Error | undefined
  projectPath: string | null
  hasProject: boolean
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

export function ChatPanel({
  messages,
  isLoading,
  error,
  projectPath,
  hasProject,
  onOpenSettings,
  onRetry,
}: ChatPanelProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [dismissedError, setDismissedError] = useState<string | null>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  })

  const lastMsg = messages[messages.length - 1]
  const lastIsStreaming = isLoading && lastMsg?.role === 'assistant'

  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')
  const lastUserMessage =
    lastUserMsg?.parts
      .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
      .map((p) => p.content)
      .join('\n') ?? null

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-8">
        {messages.length === 0 && !isLoading ? (
          <div className="flex h-full items-center justify-center -mx-8">
            <div className="flex flex-col items-center gap-6 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-bg-tertiary border border-border">
                <Hexagon className="h-8 w-8 text-text-secondary" />
              </div>
              <div className="space-y-2">
                <h2 className="text-xl font-medium text-text-primary tracking-tight">
                  Let&apos;s build
                </h2>
                {hasProject && (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-sm text-text-tertiary hover:text-text-secondary transition-colors"
                  >
                    {projectName(projectPath)}
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                )}
                {!hasProject && (
                  <p className="text-sm text-text-tertiary max-w-xs">
                    Select a project folder to get started, or just ask me anything.
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-[680px] py-4">
            {messages.map((msg, i) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                isStreaming={lastIsStreaming && i === messages.length - 1}
              />
            ))}

            {isLoading &&
              (!lastMsg || lastMsg.role !== 'assistant' || lastMsg.parts.length === 0) && (
                <div className="flex items-center gap-2 px-5 py-3">
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
                  <div className="mx-5 my-3 rounded-lg border border-error/20 bg-error/5 px-4 py-3">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="h-4 w-4 shrink-0 text-error mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-error/90">{error.message}</p>
                        {hint && <p className="text-xs text-text-tertiary mt-1">{hint}</p>}
                        <div className="flex gap-2 mt-2">
                          {isAuthError && onOpenSettings && (
                            <button
                              type="button"
                              onClick={onOpenSettings}
                              className="flex items-center gap-1.5 rounded-md bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent/20 transition-colors"
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
                              className="flex items-center gap-1.5 rounded-md bg-error/10 px-2.5 py-1 text-xs font-medium text-error hover:bg-error/20 transition-colors"
                            >
                              <RefreshCw className="h-3 w-3" />
                              Retry
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setDismissedError(error.message)}
                            className="flex items-center gap-1.5 rounded-md bg-bg-hover px-2.5 py-1 text-xs font-medium text-text-tertiary hover:text-text-secondary transition-colors"
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
        )}
      </div>
    </div>
  )
}
