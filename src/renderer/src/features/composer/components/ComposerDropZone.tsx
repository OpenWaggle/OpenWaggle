import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/cn'
import type { UseFileAttachmentResult } from '../hooks/useFileAttachment'
import { ComposerDropOverlay } from './ComposerDropOverlay'

interface ComposerDropZoneProps {
  readonly fileAttachment: UseFileAttachmentResult
  readonly children: ReactNode
}

export function ComposerDropZone({ fileAttachment, children }: ComposerDropZoneProps) {
  return (
    <section
      aria-label="Composer file drop zone"
      className={cn(
        'relative rounded-[var(--radius-panel)] bg-bg-secondary border transition-all',
        'border-input-card-border',
        'has-[:focus]:border-accent/50 has-[:focus]:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-accent)_18%,transparent)]',
        fileAttachment.isDragOver &&
          !fileAttachment.isAtCapacity &&
          'border-accent ring-2 ring-accent/30',
        fileAttachment.isDragOver &&
          fileAttachment.isAtCapacity &&
          'border-red-400/60 ring-2 ring-red-400/20',
      )}
      onDragEnter={fileAttachment.handleDragEnter}
      onDragLeave={fileAttachment.handleDragLeave}
      onDragOver={fileAttachment.handleDragOver}
      onDrop={(event) => {
        void fileAttachment.handleDrop(event)
      }}
    >
      {fileAttachment.isDragOver ? (
        <ComposerDropOverlay isAtCapacity={fileAttachment.isAtCapacity} />
      ) : null}
      {children}
    </section>
  )
}
