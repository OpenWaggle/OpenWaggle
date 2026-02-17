import type { AgentStatus } from '@shared/types/agent'
import { ArrowUp, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'

interface InputBarProps {
  onSend: (content: string) => void
  onCancel: () => void
  status: AgentStatus
  disabled?: boolean
}

export function InputBar({ onSend, onCancel, status, disabled }: InputBarProps): React.JSX.Element {
  const [input, setInput] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isActive = status === 'streaming' || status === 'tool-executing'

  useEffect(() => {
    if (status === 'idle' && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [status])

  function handleSubmit(): void {
    const trimmed = input.trim()
    if (!trimmed || isActive || disabled) return
    onSend(trimmed)
    setInput('')
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>): void {
    setInput(e.target.value)
    // Auto-resize
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }

  return (
    <div className="border-t border-border bg-bg-secondary px-4 py-3">
      <div className="flex items-end gap-2 mx-auto max-w-3xl">
        <div className="relative flex-1">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={isActive ? 'Agent is working...' : 'Message HiveCode...'}
            disabled={isActive || disabled}
            rows={1}
            className={cn(
              'w-full resize-none rounded-xl border border-border bg-bg px-4 py-3 pr-12 text-sm text-text-primary',
              'placeholder:text-text-muted',
              'focus:border-border-light focus:outline-none',
              'disabled:opacity-50',
              'transition-colors',
            )}
          />
        </div>

        {isActive ? (
          <button
            type="button"
            onClick={onCancel}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-error/15 text-error hover:bg-error/25 transition-colors"
            title="Cancel"
          >
            <Square className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!input.trim() || disabled}
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors',
              input.trim() && !disabled
                ? 'bg-accent text-black hover:bg-accent/90'
                : 'bg-bg-tertiary text-text-muted cursor-not-allowed',
            )}
            title="Send message"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  )
}
