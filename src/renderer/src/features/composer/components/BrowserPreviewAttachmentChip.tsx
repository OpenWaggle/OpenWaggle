import type { PreparedAttachment } from '@shared/types/agent'
import { ScanSearch, X } from 'lucide-react'
import { Button } from '@/shared/ui/Button'

interface BrowserPreviewAttachmentChipProps {
  readonly attachment: PreparedAttachment & {
    readonly browserPreview: NonNullable<PreparedAttachment['browserPreview']>
  }
  readonly onRemove: () => void
}

function pageLabel(pageUrl: string, pageTitle: string) {
  if (pageTitle.trim()) return pageTitle.trim()
  try {
    return new URL(pageUrl).host
  } catch {
    return 'Browser preview'
  }
}

function sourceLabel(sourceFile: string | null | undefined, sourceLine: number | null | undefined) {
  if (!sourceFile) return null
  const fileName = sourceFile.split(/[\\/]/).at(-1) || sourceFile
  return sourceLine === null || sourceLine === undefined ? fileName : `${fileName}:${sourceLine}`
}

function countedLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${String(count)} ${count === 1 ? singular : plural}`
}

function annotationSummary(context: NonNullable<PreparedAttachment['browserPreview']>) {
  if (
    context.elementCount === undefined &&
    context.regionCount === undefined &&
    context.drawingCount === undefined &&
    context.styleChangeCount === undefined
  ) {
    return null
  }
  const segments: string[] = []
  if (context.elementCount) segments.push(countedLabel(context.elementCount, 'element'))
  if (context.regionCount) segments.push(countedLabel(context.regionCount, 'region'))
  if (context.drawingCount) segments.push(countedLabel(context.drawingCount, 'drawing'))
  if (context.styleChangeCount)
    segments.push(countedLabel(context.styleChangeCount, 'style change'))
  return segments.join(' · ') || 'Preview annotation'
}

export function BrowserPreviewAttachmentChip({
  attachment,
  onRemove,
}: BrowserPreviewAttachmentChipProps) {
  const context = attachment.browserPreview
  const primaryText = context.comment || context.elementText || context.selector
  const elementLabel = context.role ? `${context.tagName} · ${context.role}` : context.tagName
  const source = sourceLabel(context.sourceFile, context.sourceLine)
  const provenance = [
    pageLabel(context.pageUrl, context.pageTitle),
    context.componentName || elementLabel,
    source,
  ]
    .filter(Boolean)
    .join(' · ')
  const summary = annotationSummary(context)

  return (
    <div className="group/chip inline-flex min-w-0 max-w-96 items-center gap-2 rounded-lg border border-accent/25 bg-accent/5 px-2.5 py-1.5 text-xs">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent/10">
        <ScanSearch className="size-4 text-accent" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <span
          className="truncate text-xs font-medium leading-tight text-text-primary"
          title={primaryText}
        >
          {primaryText}
        </span>
        <span
          className="truncate text-xs leading-tight text-text-tertiary"
          title={`${context.pageUrl} · ${elementLabel} · ${context.selector}`}
        >
          {provenance || elementLabel}
        </span>
        {summary ? (
          <span className="truncate text-xs leading-tight text-text-muted" title={summary}>
            {summary}
          </span>
        ) : null}
      </div>
      <Button
        variant="unstyled"
        onClick={onRemove}
        className="ml-0.5 rounded p-0.5 text-text-muted transition-colors hover:text-text-primary"
        title={`Remove browser annotation for ${context.selector}`}
        aria-label={`Remove browser annotation for ${context.selector}`}
      >
        <X className="size-3" />
      </Button>
    </div>
  )
}
