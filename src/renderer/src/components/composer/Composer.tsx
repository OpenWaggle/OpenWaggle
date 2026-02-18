import type { ProviderInfo, SupportedModelId } from '@shared/types/llm'
import type { Settings as SettingsType } from '@shared/types/settings'
import { ArrowUp, GitBranch, Mic, Monitor, RefreshCw, Square } from 'lucide-react'
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
    <div className="shrink-0">
      <output aria-live="polite" className="sr-only">
        {isLoading ? 'Agent is working' : ''}
      </output>

      {/* Card — cornerRadius 12, fill #111418, stroke #2a2f3a 1px */}
      <div className="rounded-xl bg-bg-secondary border border-input-card-border">
        {/* Input box — h60, padding [14,16] */}
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
              'w-full h-full resize-none bg-transparent text-[14px] text-text-primary',
              'placeholder:text-text-tertiary',
              'focus:outline-none',
              'disabled:opacity-50',
            )}
          />
        </div>

        {/* Toolbar — h44, padding [0,16], justify-between */}
        <div className="flex items-center justify-between h-11 px-4">
          {/* toolbarLeft — gap 6 */}
          <div className="flex items-center gap-1.5">
            {/* Plus icon */}
            <button
              type="button"
              disabled
              className="cursor-not-allowed text-[16px] leading-none text-text-tertiary"
              title="Attach file (coming soon)"
            >
              +
            </button>

            {/* Model selector — rendered as bordered pill */}
            <ModelSelector
              value={model}
              onChange={onModelChange}
              settings={settings}
              providerModels={providerModels}
            />

            {/* Quality button — h26, padding [0,10], cornerRadius 6, gap 5, stroke #252c36 */}
            <button
              type="button"
              disabled
              className="flex cursor-not-allowed items-center gap-[5px] h-[26px] px-2.5 rounded-md border border-button-border"
              title="Quality (coming soon)"
            >
              <span className="text-[11px] text-text-secondary">Extra High</span>
              <span className="text-[9px] text-text-tertiary">&#x2228;</span>
            </button>
          </div>

          {/* toolbarRight — gap 8 */}
          <div className="flex items-center gap-2">
            {/* Mic button — 20x20 frame */}
            <button
              type="button"
              disabled
              className="flex cursor-not-allowed items-center justify-center h-5 w-5"
              title="Voice input (coming soon)"
            >
              <Mic className="h-[15px] w-[15px] text-text-secondary" />
            </button>

            {/* Send / Cancel — 32x32, cornerRadius 15 */}
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

        {/* Status row — h36, padding [0,16], border-top #1e2229 */}
        <div className="flex items-center justify-between h-9 px-4 border-t border-border">
          {/* gbLeft — gap 4 */}
          <div className="flex items-center gap-1">
            {/* Local button — h24, padding [0,8], cornerRadius 5, gap 4 */}
            <div className="flex items-center gap-1 h-6 px-2 rounded-[5px]">
              <Monitor className="h-[13px] w-[13px] text-text-tertiary" />
              <span className="text-[11px] text-text-secondary">Local</span>
              <span className="text-[9px] text-text-tertiary">&#x2228;</span>
            </div>

            {/* Full access — h24, padding [0,8], cornerRadius 5, gap 4, all amber */}
            <div className="flex items-center gap-1 h-6 px-2 rounded-[5px]">
              <span className="text-[10px] font-bold text-accent">!</span>
              <span className="text-[11px] font-medium text-accent">Full access</span>
              <span className="text-[9px] text-accent">&#x2228;</span>
            </div>
          </div>

          {/* gbRight — gap 8 */}
          <div className="flex items-center gap-2">
            {projectPath && (
              <>
                {/* main button — h24, padding [0,8], cornerRadius 5, gap 4 */}
                <div className="flex items-center gap-1 h-6 px-2 rounded-[5px]">
                  <GitBranch className="h-[13px] w-[13px] text-text-tertiary" />
                  <span className="text-[11px] text-text-secondary">main</span>
                  <span className="text-[9px] text-text-tertiary">&#x2228;</span>
                </div>

                {/* Refresh icon — 14x14 */}
                <RefreshCw className="h-3.5 w-3.5 text-text-tertiary" />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
