import { PERCENT_BASE } from '@shared/constants/constants'
import type { PreparedAttachment } from '@shared/types/agent'
import { Check, Loader2, X } from 'lucide-react'
import type { PendingTextAttachmentChip } from './useAutoTextAttachment'

interface AutoTextAttachmentChipsProps {
  pendingTextAttachmentChips: PendingTextAttachmentChip[]
  attachments: PreparedAttachment[]
  onRemoveAttachment: (attachmentId: string) => void
  onRemovePendingAttachment: (operationId: string, attachmentId: string) => void
}

export function AutoTextAttachmentChips({
  pendingTextAttachmentChips,
  attachments,
  onRemoveAttachment,
  onRemovePendingAttachment,
}: AutoTextAttachmentChipsProps) {
  if (pendingTextAttachmentChips.length === 0 && attachments.length === 0) return null

  const attachmentIdsWithInlineProgress = new Set(
    pendingTextAttachmentChips
      .map((chip) => chip.attachmentId)
      .filter((attachmentId): attachmentId is string => typeof attachmentId === 'string'),
  )

  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {pendingTextAttachmentChips.map((chip) => (
        <span
          key={chip.operationId}
          className="inline-flex min-w-[210px] flex-col rounded-md border border-border bg-bg px-2 py-1 text-[12px] text-text-secondary"
        >
          <span className="inline-flex items-center gap-1.5">
            {chip.status === 'ready' ? (
              <Check className="h-3 w-3 text-accent" />
            ) : (
              <Loader2 className="h-3 w-3 animate-spin text-text-tertiary" />
            )}
            <span className="max-w-[120px] truncate">{chip.name}</span>
            <span className="text-[11px] text-text-tertiary">{String(chip.progressPercent)}%</span>
            {chip.status === 'ready' && chip.attachmentId ? (
              <button
                type="button"
                onClick={() => {
                  if (!chip.attachmentId) return
                  onRemovePendingAttachment(chip.operationId, chip.attachmentId)
                }}
                className="text-text-tertiary transition-colors hover:text-text-primary"
                title={`Remove ${chip.name}`}
              >
                <X className="h-3 w-3" />
              </button>
            ) : null}
          </span>
          <span
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={PERCENT_BASE}
            aria-valuenow={chip.progressPercent}
            className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-bg-tertiary"
          >
            <span
              className="block h-full bg-accent transition-[width] duration-100"
              style={{ width: `${String(chip.progressPercent)}%` }}
            />
          </span>
        </span>
      ))}
      {attachments
        .filter((attachment) => !attachmentIdsWithInlineProgress.has(attachment.id))
        .map((attachment) => (
          <span
            key={attachment.id}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg px-2 py-1 text-[12px] text-text-secondary"
          >
            <span className="max-w-[190px] truncate">{attachment.name}</span>
            <button
              type="button"
              onClick={() => onRemoveAttachment(attachment.id)}
              className="text-text-tertiary transition-colors hover:text-text-primary"
              title={`Remove ${attachment.name}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
    </div>
  )
}
