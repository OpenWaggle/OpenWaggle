import { PERCENT_BASE } from '@shared/constants/math'
import type { AttachmentKind, PreparedAttachment } from '@shared/types/agent'
import { Check, FileDown, FileText, ImageIcon, Loader2, X } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import type { PendingTextAttachmentChip } from '../hooks/useAutoTextAttachment'

const KIND_ICON: Record<AttachmentKind, typeof FileText> = {
  image: ImageIcon,
  pdf: FileDown,
  text: FileText,
}

const SIZE_UNITS = ['B', 'KB', 'MB'] as const
const SIZE_DIVISOR = 1024

function formatSize(bytes: number) {
  let value = bytes
  let unitIndex = 0
  while (value >= SIZE_DIVISOR && unitIndex < SIZE_UNITS.length - 1) {
    value /= SIZE_DIVISOR
    unitIndex++
  }
  return `${unitIndex === 0 ? String(value) : value.toFixed(1)} ${SIZE_UNITS[unitIndex]}`
}

function getExtension(name: string) {
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
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-bg-tertiary">
        <Icon className="size-4 text-text-tertiary" />
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
      <Button
        variant="unstyled"
        type="button"
        onClick={onRemove}
        className="ml-0.5 rounded p-0.5 text-text-muted transition-colors hover:text-text-primary"
        title={`Remove ${attachment.name}`}
      >
        <X className="size-3" />
      </Button>
    </div>
  )
}

interface AutoTextAttachmentChipsProps {
  pendingTextAttachmentChips: readonly PendingTextAttachmentChip[]
  attachments: readonly PreparedAttachment[]
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

  const attachmentIdsWithInlineProgress = new Set<string>()
  for (const chip of pendingTextAttachmentChips) {
    if (typeof chip.attachmentId === 'string') {
      attachmentIdsWithInlineProgress.add(chip.attachmentId)
    }
  }

  const visibleAttachments: PreparedAttachment[] = []
  for (const attachment of attachments) {
    if (!attachmentIdsWithInlineProgress.has(attachment.id)) {
      visibleAttachments.push(attachment)
    }
  }

  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {pendingTextAttachmentChips.map((chip) => (
        <span
          key={chip.operationId}
          className="inline-flex min-w-[210px] flex-col rounded-lg border border-border bg-bg px-2.5 py-1.5 text-[12px] text-text-secondary"
        >
          <span className="inline-flex items-center gap-1.5">
            {chip.status === 'ready' ? (
              <Check className="size-3 text-accent" />
            ) : (
              <Loader2 className="size-3 animate-spin text-text-tertiary" />
            )}
            <span className="max-w-[120px] truncate">{chip.name}</span>
            <span className="text-[11px] text-text-tertiary">{String(chip.progressPercent)}%</span>
            {chip.status === 'ready' && chip.attachmentId ? (
              <Button
                variant="unstyled"
                type="button"
                onClick={() => {
                  if (!chip.attachmentId) return
                  onRemovePendingAttachment(chip.operationId, chip.attachmentId)
                }}
                className="text-text-tertiary transition-colors hover:text-text-primary"
                title={`Remove ${chip.name}`}
              >
                <X className="size-3" />
              </Button>
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
      {visibleAttachments.map((attachment) => (
        <AttachmentFileChip
          key={attachment.id}
          attachment={attachment}
          onRemove={() => onRemoveAttachment(attachment.id)}
        />
      ))}
    </div>
  )
}
