import type { FeedbackCategory } from '@shared/types/feedback'
import {
  Bug,
  CheckCircle2,
  CircleAlert,
  Copy,
  ExternalLink,
  HelpCircle,
  Lightbulb,
  Loader2,
  X,
} from 'lucide-react'
import { useEffect } from 'react'
import { useFeedback } from '@/hooks/useFeedback'
import { cn } from '@/lib/cn'
import { api } from '@/lib/ipc'
import { usePreferencesStore } from '@/stores/preferences-store'
import { useUIStore } from '@/stores/ui-store'

const DESCRIPTION_ROWS = 4

interface CategoryOption {
  value: FeedbackCategory
  label: string
  icon: React.JSX.Element
}

const CATEGORIES: CategoryOption[] = [
  { value: 'bug', label: 'Bug', icon: <Bug className="h-3.5 w-3.5" /> },
  { value: 'feature', label: 'Feature', icon: <Lightbulb className="h-3.5 w-3.5" /> },
  { value: 'question', label: 'Question', icon: <HelpCircle className="h-3.5 w-3.5" /> },
]

export function FeedbackModal(): React.JSX.Element {
  const closeFeedbackModal = useUIStore((s) => s.closeFeedbackModal)
  const errorContext = useUIStore((s) => s.feedbackErrorContext)

  const lastUserMessage: string | null = null
  const activeModel = usePreferencesStore((s) => s.settings.defaultModel)
  const activeProvider: string | null = null

  const fb = useFeedback(errorContext, lastUserMessage, activeModel, activeProvider)

  // Escape to close
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeFeedbackModal()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeFeedbackModal])

  const canSubmit = fb.title.trim().length > 0 && !fb.submitting && !fb.cooldownActive
  const ghReady = fb.ghStatus?.available && fb.ghStatus.authenticated

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Report issue"
    >
      <div className="w-full max-w-[620px] rounded-xl border border-border-light bg-bg-secondary shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-text-primary">Report Issue</h2>
          <button
            type="button"
            onClick={closeFeedbackModal}
            className="rounded p-1 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 px-4 py-4">
          {/* Category selector */}
          <div className="flex gap-2">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                type="button"
                onClick={() => fb.setCategory(cat.value)}
                className={cn(
                  'flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-medium transition-colors',
                  fb.category === cat.value
                    ? 'border-accent/50 bg-accent/10 text-accent'
                    : 'border-border bg-bg text-text-secondary hover:bg-bg-hover',
                )}
              >
                {cat.icon}
                {cat.label}
              </button>
            ))}
          </div>

          {/* Title */}
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-text-secondary">Title</span>
            <input
              type="text"
              value={fb.title}
              onChange={(e) => fb.setTitle(e.target.value)}
              placeholder="Brief summary of the issue"
              className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent/50 focus:outline-none"
            />
          </label>

          {/* Description */}
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-text-secondary">
              Description
            </span>
            <textarea
              rows={DESCRIPTION_ROWS}
              value={fb.description}
              onChange={(e) => fb.setDescription(e.target.value)}
              placeholder="Steps to reproduce, expected vs. actual behavior..."
              className="w-full resize-none rounded-md border border-border bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent/50 focus:outline-none"
            />
          </label>

          {/* Attachment toggles */}
          <div className="rounded-md border border-border bg-bg p-3">
            <p className="mb-2 text-[12px] font-medium text-text-tertiary">Include with report</p>
            <div className="space-y-1.5">
              <ToggleRow
                label="System info (OS, versions)"
                checked={fb.includeSystemInfo}
                onChange={fb.setIncludeSystemInfo}
              />
              <ToggleRow
                label="Recent logs (last 100 lines)"
                checked={fb.includeLogs}
                onChange={fb.setIncludeLogs}
              />
              <ToggleRow
                label="Last error context"
                checked={fb.includeErrorContext}
                onChange={fb.setIncludeErrorContext}
                disabled={!errorContext}
              />
              <ToggleRow
                label="Last user message"
                checked={fb.includeLastMessage}
                onChange={fb.setIncludeLastMessage}
                disabled={!lastUserMessage}
              />
              <ToggleRow
                label="Model & provider info"
                checked={fb.includeModelInfo}
                onChange={fb.setIncludeModelInfo}
              />
            </div>
          </div>

          {/* gh CLI status */}
          {fb.ghStatus !== null && (
            <div
              className={cn(
                'flex items-center gap-2 rounded-md border px-3 py-2 text-[13px]',
                ghReady
                  ? 'border-success/30 bg-success/6 text-success'
                  : 'border-warning/30 bg-warning/6 text-warning',
              )}
            >
              {ghReady ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  Ready to submit via GitHub CLI
                </>
              ) : (
                <>
                  <CircleAlert className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    {fb.ghStatus.available
                      ? 'GitHub CLI not authenticated — run '
                      : 'GitHub CLI not found — install from '}
                    {fb.ghStatus.available ? (
                      <code className="rounded bg-bg px-1 py-0.5 text-[12px]">gh auth login</code>
                    ) : (
                      <a
                        href="https://cli.github.com"
                        onClick={(e) => {
                          e.preventDefault()
                          api.openExternal('https://cli.github.com').catch(() => {})
                        }}
                        className="underline hover:no-underline"
                      >
                        cli.github.com
                      </a>
                    )}
                    {' — or use "Copy & Open GitHub" below'}
                  </span>
                </>
              )}
            </div>
          )}

          {/* Error message */}
          {fb.error && <p className="text-[13px] text-error">{fb.error}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={closeFeedbackModal}
            className="rounded-md border border-border px-3 py-1.5 text-[13px] text-text-secondary transition-colors hover:bg-bg-hover"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void fb.copyAndOpen()}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[13px] font-medium text-text-secondary transition-colors hover:bg-bg-hover"
          >
            <Copy className="h-3 w-3" />
            Copy & Open GitHub
            <ExternalLink className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => void fb.submit()}
            disabled={!canSubmit || !ghReady}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-semibold transition-colors',
              canSubmit && ghReady
                ? 'bg-gradient-to-b from-accent to-accent-dim text-bg'
                : 'cursor-not-allowed border border-border bg-bg-tertiary text-text-tertiary',
            )}
          >
            {fb.submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Submit Issue
          </button>
        </div>
      </div>
    </div>
  )
}

interface ToggleRowProps {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}

function ToggleRow({ label, checked, onChange, disabled }: ToggleRowProps): React.JSX.Element {
  return (
    <label
      className={cn(
        'flex items-center gap-2 text-[13px]',
        disabled
          ? 'text-text-tertiary/50 cursor-not-allowed'
          : 'text-text-secondary cursor-pointer',
      )}
    >
      <input
        type="checkbox"
        checked={checked && !disabled}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="h-3.5 w-3.5 rounded border-border bg-bg"
      />
      {label}
    </label>
  )
}
