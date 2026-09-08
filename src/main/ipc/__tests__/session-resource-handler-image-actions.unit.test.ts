import type { PreparedAttachment } from '@shared/types/agent'
import { SessionId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getSessionResourceHandlerMocks,
  invokeSessionResourceHandler as invoke,
  invokeSessionResourceOwnerHandler,
  resetSessionResourceHandlerHarness,
} from './session-resource-handler.test-harness'

const actionMocks = vi.hoisted(() => ({
  createFromBuffer: vi.fn(),
  discardRegisteredImageAttachment: vi.fn(),
  isEmpty: vi.fn(),
  prepareRegisteredImageAttachmentFromBytes: vi.fn(),
  writeImage: vi.fn(),
}))

vi.mock('electron', () => ({
  clipboard: { writeImage: actionMocks.writeImage },
  nativeImage: { createFromBuffer: actionMocks.createFromBuffer },
}))

vi.mock('../attachments-handler', () => ({
  discardRegisteredImageAttachment: actionMocks.discardRegisteredImageAttachment,
  prepareRegisteredImageAttachmentFromBytes: actionMocks.prepareRegisteredImageAttachmentFromBytes,
}))

const handlerMocks = getSessionResourceHandlerMocks()

const IMAGE: SessionResource = {
  id: 'image-one',
  sessionId: SessionId('session-one'),
  canonicalKey: 'sha256:image-one',
  kind: 'image',
  title: 'image-one.png',
  mimeType: 'image/png',
  locator: 'session-resource://image-one',
  managed: true,
  available: true,
  isSource: true,
  isOutput: false,
  occurrences: [],
  createdAt: 1,
  updatedAt: 1,
}

const PREPARED: PreparedAttachment = {
  id: 'prepared-image',
  kind: 'image',
  name: 'image-one.png',
  path: '/registered/image-one.png',
  mimeType: 'image/png',
  sizeBytes: 10,
  extractedText: '',
}

describe('session resource image actions', () => {
  beforeEach(() => {
    resetSessionResourceHandlerHarness()
    actionMocks.isEmpty.mockReset().mockReturnValue(false)
    actionMocks.createFromBuffer.mockReset().mockReturnValue({ isEmpty: actionMocks.isEmpty })
    actionMocks.writeImage.mockReset()
    actionMocks.discardRegisteredImageAttachment.mockReset().mockResolvedValue(undefined)
    actionMocks.prepareRegisteredImageAttachmentFromBytes.mockReset().mockResolvedValue(PREPARED)
    handlerMocks.findById.mockImplementation((sessionId: SessionId, resourceId: string) =>
      sessionId === IMAGE.sessionId && resourceId === IMAGE.id ? IMAGE : null,
    )
    handlerMocks.getContentLocation.mockReturnValue({
      resourceId: IMAGE.id,
      sessionId: IMAGE.sessionId,
      fileName: IMAGE.title,
      mimeType: 'image/png',
      managedPath: '/managed/image-one.png',
    })
    handlerMocks.read.mockReturnValue(Buffer.from('image-bytes'))
  })

  it('copies only the owning session image through the main-process clipboard', async () => {
    await expect(
      invoke('sessions:resources:copy-image', SessionId('session-one'), IMAGE.id),
    ).resolves.toBeUndefined()

    expect(handlerMocks.findById).toHaveBeenCalledWith(SessionId('session-one'), IMAGE.id, 'images')
    expect(actionMocks.createFromBuffer).toHaveBeenCalledOnce()
    expect(actionMocks.writeImage).toHaveBeenCalledOnce()
  })

  it.each(['sessions:resources:copy-image', 'sessions:resources:prepare-attachment'])(
    'rejects a cross-session resource on %s',
    async (channel) => {
      await expect(invoke(channel, SessionId('session-two'), IMAGE.id)).rejects.toThrow(
        'not an image',
      )

      expect(actionMocks.writeImage).not.toHaveBeenCalled()
      expect(actionMocks.prepareRegisteredImageAttachmentFromBytes).not.toHaveBeenCalled()
    },
  )

  it.each(['sessions:resources:copy-image', 'sessions:resources:prepare-attachment'])(
    'rejects a stale %s action after the opened Session changes',
    async (channel) => {
      await invokeSessionResourceOwnerHandler(SessionId('session-two'))

      await expect(invoke(channel, SessionId('session-one'), IMAGE.id)).rejects.toThrow(
        'no longer owned by the opened Session',
      )

      expect(handlerMocks.findById).not.toHaveBeenCalled()
      expect(handlerMocks.read).not.toHaveBeenCalled()
      expect(actionMocks.writeImage).not.toHaveBeenCalled()
      expect(actionMocks.prepareRegisteredImageAttachmentFromBytes).not.toHaveBeenCalled()
    },
  )

  it('rejects non-image and unavailable resources before reading their content', async () => {
    handlerMocks.findById
      .mockReturnValueOnce({ ...IMAGE, kind: 'file' })
      .mockReturnValueOnce({ ...IMAGE, available: false })

    await expect(
      invoke('sessions:resources:copy-image', SessionId('session-one'), IMAGE.id),
    ).rejects.toThrow('not an image')
    await expect(
      invoke('sessions:resources:copy-image', SessionId('session-one'), IMAGE.id),
    ).rejects.toThrow('unavailable')

    expect(handlerMocks.read).not.toHaveBeenCalled()
    expect(actionMocks.writeImage).not.toHaveBeenCalled()
  })

  it('prepares an isolated attachment from bytes read through the managed store', async () => {
    await expect(
      invoke('sessions:resources:prepare-attachment', SessionId('session-one'), IMAGE.id),
    ).resolves.toEqual(PREPARED)

    expect(handlerMocks.getContentLocation).toHaveBeenCalledWith(SessionId('session-one'), IMAGE.id)
    expect(handlerMocks.read).toHaveBeenCalledWith('/managed/image-one.png')
    expect(actionMocks.prepareRegisteredImageAttachmentFromBytes).toHaveBeenCalledWith({
      bytes: Buffer.from('image-bytes'),
      fileName: 'image-one.png',
      mimeType: 'image/png',
    })
  })

  it('revokes a prepared attachment when its owning Session changes during preparation', async () => {
    const preparation = Promise.withResolvers<PreparedAttachment>()
    actionMocks.prepareRegisteredImageAttachmentFromBytes.mockReturnValue(preparation.promise)
    await invokeSessionResourceOwnerHandler(SessionId('session-one'))
    const pending = invoke(
      'sessions:resources:prepare-attachment',
      SessionId('session-one'),
      IMAGE.id,
    )
    await vi.waitFor(() =>
      expect(actionMocks.prepareRegisteredImageAttachmentFromBytes).toHaveBeenCalledOnce(),
    )

    await invokeSessionResourceOwnerHandler(SessionId('session-two'))
    preparation.resolve(PREPARED)

    await expect(pending).rejects.toThrow('no longer owned by the opened Session')
    expect(actionMocks.discardRegisteredImageAttachment).toHaveBeenCalledWith(PREPARED)
  })

  it('does not register an attachment when the managed store rejects its path', async () => {
    handlerMocks.read.mockImplementation(() => {
      throw new Error('managed path escaped')
    })

    await expect(
      invoke('sessions:resources:prepare-attachment', SessionId('session-one'), IMAGE.id),
    ).rejects.toThrow('managed path escaped')

    expect(actionMocks.prepareRegisteredImageAttachmentFromBytes).not.toHaveBeenCalled()
  })

  it('rejects an image that has no readable managed attachment copy', async () => {
    handlerMocks.getContentLocation.mockReturnValue(null)

    await expect(
      invoke('sessions:resources:prepare-attachment', SessionId('session-one'), IMAGE.id),
    ).rejects.toThrow('no managed attachment copy')

    expect(actionMocks.prepareRegisteredImageAttachmentFromBytes).not.toHaveBeenCalled()
  })
})
