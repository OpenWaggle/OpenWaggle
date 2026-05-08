import { GitBranch } from 'lucide-react'
import { useEscapeHotkey } from '@/hooks/useEscapeHotkey'
import { cn } from '@/lib/cn'
import type { SessionForkTarget } from './session-fork-targets'

interface SessionForkSelectorProps {
  readonly open: boolean
  readonly targets: readonly SessionForkTarget[]
  readonly onSelect: (target: SessionForkTarget) => void
  readonly onClose: () => void
}

const PREVIEW_LIMIT = 180

function previewText(text: string): string {
  return text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT).trim()}...` : text
}

export function SessionForkSelector({
  open,
  targets,
  onSelect,
  onClose,
}: SessionForkSelectorProps) {
  useEscapeHotkey(onClose, { enabled: open })

  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4">
      <section className="w-full max-w-[520px] rounded-xl border border-border-light bg-bg-secondary p-4 shadow-2xl">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <GitBranch className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-text-primary">Fork to new session</h3>
            <p className="mt-1 text-[12px] text-text-tertiary">
              Select a previous user message. The new session starts before it and prefills the
              composer with that text.
            </p>
          </div>
        </div>

        <div className="mt-4 max-h-[360px] overflow-y-auto rounded-lg border border-border bg-bg">
          {targets.length === 0 ? (
            <div className="px-3 py-6 text-center text-[13px] text-text-tertiary">
              No user messages are available to fork.
            </div>
          ) : (
            targets.map((target) => (
              <button
                key={String(target.entryId)}
                type="button"
                onClick={() => onSelect(target)}
                className={cn(
                  'block w-full border-b border-border px-3 py-2.5 text-left transition-colors last:border-b-0',
                  'hover:bg-bg-hover focus:bg-bg-hover focus:outline-none',
                )}
              >
                <span className="block text-[12px] font-medium text-text-secondary">
                  {String(target.entryId)}
                </span>
                <span className="mt-1 line-clamp-3 block text-[12px] leading-5 text-text-tertiary">
                  {previewText(target.text)}
                </span>
              </button>
            ))
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-md border border-border px-3 text-[12px] text-text-secondary transition-colors hover:bg-bg-hover"
          >
            Cancel
          </button>
        </div>
      </section>
    </div>
  )
}
