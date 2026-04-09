import { PERCENT_BASE } from '@shared/constants/constants'
import type { AttachmentKind, PreparedAttachment } from '@shared/types/agent'
import { Check, FileDown, FileText, ImageIcon, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { PendingTextAttachmentChip } from './useAutoTextAttachment'

const KIND_ICON: Record<AttachmentKind, typeof FileText> = {
  image: ImageIcon,
  pdf: FileDown,
  text: FileText,
}

const SIZE_UNITS = ['B', 'KB', 'MB'] as const
const SIZE_DIVISOR = 1024

function formatSize(bytes: number): string {
  let value = bytes
  let unitIndex = 0
  while (value >= SIZE_DIVISOR && unitIndex < SIZE_UNITS.length - 1) {
    value /= SIZE_DIVISOR
    unitIndex++
  }
  return `${unitIndex === 0 ? String(value) : value.toFixed(1)} ${SIZE_UNITS[unitIndex]}`
}

function getExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toUpperCase() : ''
}

function AttachmentFileChip({
  attachment,
  onRemove,
}: {
  readonly attachment: PreparedAttachment
  readonly onRemove: () => void
}) {
  const Icon = KIND_ICON[attachment.kind]
  const ext = getExtension(attachment.name)

  return (
    <div
      className={cn(
        'group/chip relative inline-flex items-center gap-2 rounded-lg border border-border',
        'bg-bg px-2.5 py-1.5 text-[12px] text-text-secondary',
      )}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-bg-tertiary">
        <Icon className="h-4 w-4 text-text-tertiary" />
      </div>
      <div className="flex flex-col gap-0 overflow-hidden">
        <span className="max-w-[180px] truncate text-[12px] font-medium leading-tight text-text-primary">
          {attachment.name}
        </span>
        <span className="text-[10px] leading-tight text-text-tertiary">
          {ext && `${ext} \u00B7 `}
          {formatSize(attachment.sizeBytes)}
        </span>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="ml-0.5 rounded p-0.5 text-text-muted transition-colors hover:text-text-primary"
        title={`Remove ${attachment.name}`}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

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
          className="inline-flex min-w-[210px] flex-col rounded-lg border border-border bg-bg px-2.5 py-1.5 text-[12px] text-text-secondary"
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
          <AttachmentFileChip
            key={attachment.id}
            attachment={attachment}
            onRemove={() => onRemoveAttachment(attachment.id)}
          />
        ))}
    </div>
  )
}
