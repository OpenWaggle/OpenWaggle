import type { ProviderInfo, SupportedModelId } from '@shared/types/llm'
import type { Settings as SettingsType } from '@shared/types/settings'
import { ArrowUp, ChevronDown, Gauge, Plus, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ModelSelector } from '@/components/shared/ModelSelector'
import { cn } from '@/lib/cn'

const CONTENT_MAX_WIDTH = 740

interface ComposerProps {
  onSend: (content: string) => void
  onCancel: () => void
  isLoading: boolean
  disabled?: boolean
  model: SupportedModelId
  onModelChange: (model: SupportedModelId) => void
  settings: SettingsType
  providerModels: ProviderInfo[]
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
    <div className="shrink-0 border-t border-border/85 bg-bg/72 pb-4 pt-4 backdrop-blur-md">
      <output aria-live="polite" className="sr-only">
        {isLoading ? 'Agent is working' : ''}
      </output>

      <div className="flex w-full justify-center px-8 md:px-12">
        <div
          className="w-full rounded-2xl border border-border-light bg-bg-secondary shadow-[0_8px_20px_rgba(0,0,0,0.22)] transition-colors focus-within:border-border-light"
          style={{ maxWidth: CONTENT_MAX_WIDTH }}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            aria-label="Message input"
            placeholder={
              isLoading ? 'Agent is working...' : 'Ask anything, @ to add files, / for commands'
            }
            disabled={isLoading || disabled}
            rows={2}
            className={cn(
              'w-full min-h-[102px] resize-none bg-transparent px-5 pb-3 pt-4 text-sm leading-relaxed text-text-primary',
              'placeholder:text-text-tertiary',
              'focus:outline-none',
              'disabled:opacity-50',
            )}
          />

          <div className="flex items-center justify-between border-t border-border/75 px-4 py-2.5">
            <div className="flex items-center gap-1">
              {/* Attach button */}
              <button
                type="button"
                disabled
                className="flex cursor-not-allowed items-center justify-center rounded-md p-1.5 text-text-muted/80 transition-colors hover:text-text-tertiary"
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
              />

              {/* Effort dropdown */}
              <button
                type="button"
                disabled
                className="flex cursor-not-allowed items-center gap-1 rounded-md px-2 py-1.5 text-xs text-text-muted/80 transition-colors hover:text-text-tertiary"
                title="Effort level (coming soon)"
              >
                <Gauge className="h-3.5 w-3.5" />
                Auto
                <ChevronDown className="h-3 w-3" />
              </button>
            </div>

            <div className="flex items-center gap-2">
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
                    'flex h-8 w-8 items-center justify-center rounded-full border transition-colors',
                    canSend
                      ? 'border-border-light bg-text-primary text-bg hover:bg-white'
                      : 'border-border bg-bg-tertiary text-text-muted cursor-not-allowed',
                  )}
                  title="Send message"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
