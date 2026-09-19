import type { PreparedAttachment } from '@shared/types/agent'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { markSessionResourceAttachmentsSubmitted } from '../composer-attachment-lifecycle'
import { useComposerStore } from '../composer-store'

const discardPreparedAttachment = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('@/shared/lib/ipc', () => ({ api: { discardPreparedAttachment } }))

const viewerImage: PreparedAttachment = {
  id: 'viewer-image',
  kind: 'image',
  origin: 'session-resource',
  name: 'viewer.png',
  path: '/temporary/resource-viewer.png',
  mimeType: 'image/png',
  sizeBytes: 3,
  extractedText: '',
}

describe('composer Session resource attachment lifecycle', () => {
  beforeEach(() => {
    useComposerStore.getState().reset()
    discardPreparedAttachment.mockClear()
  })

  it('discards a viewer image when its chip is removed', () => {
    useComposerStore.getState().addAttachments([viewerImage])
    useComposerStore.getState().removeAttachment(viewerImage.id)

    expect(discardPreparedAttachment).toHaveBeenCalledExactlyOnceWith(viewerImage)
  })

  it('keeps a viewer image through a draft switch and discards it when its saved draft is cleared', () => {
    useComposerStore.getState().setActiveDraftContextKey('session:first')
    useComposerStore.getState().addAttachments([viewerImage])
    useComposerStore.getState().switchScopedDraftContext('session:second')

    expect(discardPreparedAttachment).not.toHaveBeenCalled()
    useComposerStore.getState().clearScopedDraft('session:first')
    expect(discardPreparedAttachment).toHaveBeenCalledExactlyOnceWith(viewerImage)
  })

  it('does not discard a sent image when submission clears the composer', () => {
    useComposerStore.getState().addAttachments([viewerImage])
    markSessionResourceAttachmentsSubmitted([viewerImage])
    useComposerStore.getState().reset()

    expect(discardPreparedAttachment).not.toHaveBeenCalled()
  })

  it('discards abandoned viewer images on replacement but never ordinary user files', () => {
    const file: PreparedAttachment = { ...viewerImage, id: 'user-file', origin: 'user-file' }
    useComposerStore.getState().addAttachments([viewerImage, file])
    useComposerStore.getState().replaceAttachments([])

    expect(discardPreparedAttachment).toHaveBeenCalledExactlyOnceWith(viewerImage)
  })

  it('does not scan or discard attachments when only the text changes', () => {
    useComposerStore.getState().addAttachments([viewerImage])
    useComposerStore.getState().setInput('Describe this diagram')

    expect(discardPreparedAttachment).not.toHaveBeenCalled()
  })
})
