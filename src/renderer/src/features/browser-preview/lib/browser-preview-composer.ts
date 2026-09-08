import { ATTACHMENT } from '@shared/constants/resource-limits'
import type { BrowserPreviewAnnotation } from '@shared/types/browser-preview-controls'
import { useComposerStore } from '@/features/composer/state'

/** Adds a picked element to the same scoped draft that was active when picking began. */
export function appendBrowserPreviewAnnotationToComposer(
  annotation: BrowserPreviewAnnotation,
  expectedDraftContextKey: string | null,
): void {
  const composer = useComposerStore.getState()
  if (composer.activeDraftContextKey !== expectedDraftContextKey) {
    throw new Error('The active draft changed before the browser annotation was attached.')
  }
  if (composer.attachments.length >= ATTACHMENT.MAX_COUNT) {
    throw new Error(
      `Remove an attachment before adding browser context (maximum ${String(ATTACHMENT.MAX_COUNT)}).`,
    )
  }
  const attachment = annotation.attachment
  if (attachment === null) {
    throw new Error('The selected element screenshot was too large to attach to the message.')
  }
  if (composer.attachments.some((existing) => existing.id === attachment.id)) {
    return
  }
  composer.setAttachmentError(null)
  composer.addAttachments([attachment])
  composer.lexicalEditor?.focus()
}

export function activeBrowserPreviewComposerDraft(): string | null {
  return useComposerStore.getState().activeDraftContextKey
}
