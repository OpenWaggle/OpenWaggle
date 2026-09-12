import { beforeEach, describe, expect, it } from 'vitest'
import {
  BrowserPreviewManager,
  createOwner,
  createWindow,
  firstView,
  getBrowserPreviewElectronMocks,
  getBrowserPreviewOwnerRegistryMock,
  openInput,
} from './browser-preview-test-harness'

const electronMocks = getBrowserPreviewElectronMocks()

describe('browser preview idempotent close', () => {
  beforeEach(() => {
    electronMocks.createdViews.splice(0)
    electronMocks.windowFromWebContents.mockReturnValue(createWindow().window)
    getBrowserPreviewOwnerRegistryMock().assertRegistered.mockReset()
  })

  it('accepts absent launcher and restored preview IDs without creating native views', () => {
    const manager = new BrowserPreviewManager()
    const { owner } = createOwner()
    expect(() => manager.close(owner, 'launcher-never-opened')).not.toThrow()
    expect(() => manager.close(owner, 'restored-unmounted-preview')).not.toThrow()
    expect(electronMocks.createdViews).toHaveLength(0)
  })

  it('disposes an owned view exactly once across repeated close requests', () => {
    const manager = new BrowserPreviewManager()
    const { owner } = createOwner()
    manager.open(owner, openInput())
    const view = firstView()
    manager.close(owner, 'preview-1')
    expect(() => manager.close(owner, 'preview-1')).not.toThrow()
    expect(view.webContents.close).toHaveBeenCalledOnce()
    expect(manager.findOwnedPreview('session-1', 'preview-1')).toBeUndefined()
  })

  it.each([17, 18])('rejects an existing foreign preview with sender ID %s', (senderId) => {
    const manager = new BrowserPreviewManager()
    const { owner } = createOwner()
    manager.open(owner, openInput())
    const foreign = createOwner(senderId).owner
    expect(() => manager.close(foreign, 'preview-1')).toThrow()
    expect(firstView().webContents.close).not.toHaveBeenCalled()
    expect(manager.findOwnedPreview('session-1', 'preview-1')).toBeDefined()
    manager.close(owner, 'preview-1')
  })
})
