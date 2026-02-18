import type { ProviderInfo, SupportedModelId } from '@shared/types/llm'
import type { Settings as SettingsType } from '@shared/types/settings'
import {
  ArrowUp,
  ChevronDown,
  Gauge,
  GitBranch,
  Mic,
  Monitor,
  Plus,
  RefreshCw,
  Shield,
  Square,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ModelSelector } from '@/components/shared/ModelSelector'
import { cn } from '@/lib/cn'

interface ComposerProps {
  onSend: (content: string) => void
  onCancel: () => void
  isLoading: boolean
  disabled?: boolean
  model: SupportedModelId
  onModelChange: (model: SupportedModelId) => void
  settings: SettingsType
  providerModels: ProviderInfo[]
  projectPath?: string | null
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
}: ComposerProps): React.JSX.Element {
  const [input, setInput] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!isLoading && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [isLoading])

  function handleSubmit(): void {
    const trimmed = input.trim()
    if (!trimmed || isLoading || disabled) return
    onSend(trimmed)
    setInput('')
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
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }

  const canSend = !!input.trim() && !disabled

  return (
    <div className="shrink-0 px-0 pb-5">
      <output aria-live="polite" className="sr-only">
        {isLoading ? 'Agent is working' : ''}
      </output>

      <div className="w-full rounded-xl border border-input-card-border bg-bg-secondary">
        {/* Input area */}
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
            'w-full min-h-[60px] resize-none bg-transparent px-4 pb-2 pt-4 text-sm leading-relaxed text-text-primary',
            'placeholder:text-text-tertiary',
            'focus:outline-none',
            'disabled:opacity-50',
          )}
        />

        {/* Toolbar */}
        <div className="flex h-11 items-center justify-between px-4">
          <div className="flex items-center gap-1">
            {/* Attach button */}
            <button
              type="button"
              disabled
              className="flex cursor-not-allowed items-center justify-center rounded-md p-1.5 text-text-tertiary transition-colors hover:text-text-secondary"
              title="Attach file (coming soon)"
            >
              <Plus className="h-4 w-4" />
            </button>

            {/* Model selector */}
            <ModelSelector
              value={model}
              onChange={onModelChange}
              settings={settings}
              providerModels={providerModels}
              className="rounded-md border border-button-border px-2 py-0.5"
            />

            {/* Quality selector */}
            <button
              type="button"
              disabled
              className="flex cursor-not-allowed items-center gap-1 rounded-md border border-button-border px-2 py-1 text-[12px] text-text-secondary transition-colors hover:text-text-primary"
              title="Quality (coming soon)"
            >
              <Gauge className="h-3.5 w-3.5" />
              Extra High
              <ChevronDown className="h-3 w-3 opacity-50" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            {/* Mic button */}
            <button
              type="button"
              disabled
              className="cursor-not-allowed text-text-secondary transition-colors hover:text-text-primary"
              title="Voice input (coming soon)"
            >
              <Mic className="h-4 w-4" />
            </button>

            {/* Send / Cancel */}
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
                    ? 'bg-gradient-to-b from-accent to-accent-dim text-bg'
                    : 'border border-border bg-bg-tertiary text-text-muted cursor-not-allowed',
                )}
                title="Send message"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Status row */}
        <div className="flex h-9 items-center justify-between border-t border-border px-4 text-[11px] text-text-tertiary">
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled
              className="flex cursor-not-allowed items-center gap-1 rounded-[5px] py-0.5 pr-1 text-text-tertiary"
            >
              <Monitor className="h-3.5 w-3.5" />
              Local
              <ChevronDown className="h-2.5 w-2.5 opacity-50" />
            </button>

            <span className="flex items-center gap-1 text-accent">
              <Shield className="h-3.5 w-3.5" />
              Full access
            </span>
          </div>

          <div className="flex items-center gap-2">
            {projectPath && (
              <button
                type="button"
                disabled
                className="flex cursor-not-allowed items-center gap-1 rounded-[5px] py-0.5 pr-1 text-text-tertiary"
              >
                <GitBranch className="h-3.5 w-3.5" />
                main
                <ChevronDown className="h-2.5 w-2.5 opacity-50" />
              </button>
            )}
            <button
              type="button"
              disabled
              className="cursor-not-allowed text-text-tertiary transition-colors hover:text-text-secondary"
              title="Refresh"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
