import { GitBranch, Loader2 } from 'lucide-react'
import { type BranchSummaryPromptMode, useBranchSummaryStore } from '@/features/chat/state'
import { useEscapeHotkey } from '@/shared/hooks/useEscapeHotkey'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'

interface BranchSummaryPromptProps {
  readonly onNoSummary: () => void
  readonly onSummarize: () => void
  readonly onCustomSummary: () => void
  readonly onCancel: () => void
}

function modeCopy(mode: BranchSummaryPromptMode) {
  if (mode === 'custom') {
    return 'Write custom summary instructions in the composer, then press Send.'
  }
  if (mode === 'summarizing') {
    return 'Summarizing the abandoned branch before creating this branch…'
  }
  return 'Keep context from the abandoned branch?'
}

function SummaryButton({
  children,
  disabled,
  onClick,
  variant = 'secondary',
}: {
  readonly children: React.ReactNode
  readonly disabled?: boolean
  readonly onClick: () => void
  readonly variant?: 'primary' | 'secondary' | 'ghost'
}) {
  return (
    <Button
      variant="unstyled"
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'h-6 rounded-md px-2 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        variant === 'primary' && 'bg-accent text-bg hover:bg-accent-dim',
        variant === 'secondary' && 'border border-border text-text-secondary hover:bg-bg-hover',
        variant === 'ghost' && 'text-text-tertiary hover:bg-bg-hover hover:text-text-secondary',
      )}
    >
      {children}
    </Button>
  )
}

export function BranchSummaryPrompt({
  onNoSummary,
  onSummarize,
  onCustomSummary,
  onCancel,
}: BranchSummaryPromptProps) {
  const prompt = useBranchSummaryStore((state) => state.prompt)
  const mode = prompt?.mode ?? null
  const busy = mode === 'summarizing'

  useEscapeHotkey(onCancel, { enabled: mode !== null && !busy })

  if (!mode) {
    return null
  }

  return (
    <div className="mb-2 rounded-[var(--radius-panel)] border border-accent/20 bg-accent/7 px-3 py-2 text-[12px] text-text-secondary">
      <div className="flex min-w-0 items-center gap-2">
        <GitBranch className="size-3.5 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-text-primary">Branch summary</div>
          <div className="truncate text-text-tertiary">{modeCopy(mode)}</div>
        </div>
        {busy ? <Loader2 className="size-3.5 animate-spin text-accent" /> : null}
      </div>

      {mode === 'choice' ? (
        <div className="mt-2 flex flex-wrap justify-end gap-1.5">
          <SummaryButton onClick={onCancel} variant="ghost">
            Cancel
          </SummaryButton>
          <SummaryButton onClick={onNoSummary}>No summary</SummaryButton>
          <SummaryButton onClick={onCustomSummary}>Custom</SummaryButton>
          <SummaryButton onClick={onSummarize} variant="primary">
            Summarize
          </SummaryButton>
        </div>
      ) : null}

      {mode === 'custom' ? (
        <div className="mt-2 flex flex-wrap justify-end gap-1.5">
          <SummaryButton onClick={onNoSummary}>No summary</SummaryButton>
          <SummaryButton onClick={onCancel} variant="ghost">
            Cancel
          </SummaryButton>
        </div>
      ) : null}
    </div>
  )
}
