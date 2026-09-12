import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  afterEach(() => vi.useRealTimers())
  beforeEach(() => {
    electronMocks.createdViews.splice(0)
    electronMocks.windowFromWebContents.mockReturnValue(createWindow().window)
    getBrowserPreviewOwnerRegistryMock().assertRegistered.mockReset()
  })

  it('accepts absent launcher and restored preview IDs without creating native views', async () => {
    const manager = new BrowserPreviewManager()
    const { owner } = createOwner()
    await expect(manager.close(owner, 'launcher-never-opened')).resolves.toBeUndefined()
    await expect(manager.close(owner, 'restored-unmounted-preview')).resolves.toBeUndefined()
    expect(electronMocks.createdViews).toHaveLength(0)
  })

  it('disposes an owned view exactly once across repeated close requests', async () => {
    const manager = new BrowserPreviewManager()
    const { owner } = createOwner()
    manager.open(owner, openInput())
    const view = firstView()
    await manager.close(owner, 'preview-1')
    await expect(manager.close(owner, 'preview-1')).resolves.toBeUndefined()
    expect(view.webContents.close).toHaveBeenCalledOnce()
    expect(manager.findOwnedPreview('session-1', 'preview-1')).toBeUndefined()
  })

  it('rejects a failed live native close and retains ownership for a successful retry', async () => {
    const manager = new BrowserPreviewManager()
    const { owner } = createOwner()
    manager.open(owner, openInput())
    const view = firstView()
    const failure = new Error('Live native close failed')
    view.webContents.close.mockImplementationOnce(() => {
      throw failure
    })
    await expect(manager.close(owner, 'preview-1')).rejects.toBe(failure)
    expect(view.webContents.destroyed).toBe(false)
    expect(manager.findOwnedPreview('session-1', 'preview-1')).toBeDefined()
    expect(() => manager.open(owner, openInput({ ownerKey: 'another-session' }))).toThrow(
      'cannot change',
    )
    await manager.close(owner, 'preview-1')
    expect(view.webContents.destroyed).toBe(true)
    expect(view.webContents.close).toHaveBeenCalledTimes(2)
    expect(manager.findOwnedPreview('session-1', 'preview-1')).toBeUndefined()
  })

  it('waits for asynchronous destruction, deduplicates requests and suppresses intentional closed errors', async () => {
    const manager = new BrowserPreviewManager()
    const { owner, send } = createOwner()
    manager.open(owner, openInput())
    const view = firstView()
    view.webContents.close.mockImplementationOnce(() => undefined)
    send.mockClear()
    const first = manager.close(owner, 'preview-1')
    const second = manager.close(owner, 'preview-1')
    expect(second).toBe(first)
    let settled = false
    void first.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(manager.findOwnedPreview('session-1', 'preview-1')).toBeDefined()
    view.webContents.destroyed = true
    view.webContents.emit('destroyed')
    await first
    expect(view.webContents.close).toHaveBeenCalledOnce()
    expect(manager.findOwnedPreview('session-1', 'preview-1')).toBeUndefined()
    expect(send).not.toHaveBeenCalledWith(
      'browser-preview:state',
      expect.objectContaining({
        error: expect.objectContaining({ code: 'CONTENT_CLOSED' }),
      }),
    )
  })

  it('retains ownership on timeout and releases it on a later destruction event', async () => {
    vi.useFakeTimers()
    const manager = new BrowserPreviewManager()
    const { owner, send } = createOwner()
    manager.open(owner, openInput())
    const view = firstView()
    const originalListeners = view.webContents.listenerCount('destroyed')
    view.webContents.close.mockImplementationOnce(() => undefined)
    const closed = expect(manager.close(owner, 'preview-1')).rejects.toThrow('deadline')
    await vi.advanceTimersByTimeAsync(2_000)
    await closed
    expect(vi.getTimerCount()).toBe(0)
    expect(view.webContents.listenerCount('destroyed')).toBe(originalListeners)
    expect(manager.findOwnedPreview('session-1', 'preview-1')).toBeDefined()
    view.webContents.destroyed = true
    view.webContents.emit('destroyed')
    expect(manager.findOwnedPreview('session-1', 'preview-1')).toBeUndefined()
    expect(send).toHaveBeenCalledWith(
      'browser-preview:state',
      expect.objectContaining({
        error: expect.objectContaining({ code: 'CONTENT_CLOSED' }),
      }),
    )
    await manager.close(owner, 'preview-1')
  })

  it('accepts confirmed destruction even if native close subsequently throws', async () => {
    const manager = new BrowserPreviewManager()
    const { owner } = createOwner()
    manager.open(owner, openInput())
    const view = firstView()
    view.webContents.close.mockImplementationOnce(() => {
      view.webContents.destroyed = true
      view.webContents.emit('destroyed')
      throw new Error('Already destroyed wrapper')
    })
    await expect(manager.close(owner, 'preview-1')).resolves.toBeUndefined()
    expect(manager.findOwnedPreview('session-1', 'preview-1')).toBeUndefined()
  })

  it('preserves failed explicit-close records across owner teardown until retry succeeds', async () => {
    const manager = new BrowserPreviewManager()
    const { owner, emitter } = createOwner()
    manager.open(owner, openInput())
    const view = firstView()
    const failure = new Error('Native content still alive')
    view.webContents.close.mockImplementation(() => {
      throw failure
    })
    await expect(manager.close(owner, 'preview-1')).rejects.toBe(failure)
    emitter.emit('destroyed')
    await Promise.resolve()
    expect(manager.findOwnedPreview('session-1', 'preview-1')).toBeDefined()
    expect(() => manager.close(createOwner(18).owner, 'preview-1')).toThrow('not owned')
    expect(() => manager.open(owner, openInput({ ownerKey: 'new-owner' }))).toThrow(
      'cleanup is pending',
    )
    await expect(manager.close(owner, 'preview-1')).rejects.toBe(failure)
    view.webContents.close.mockImplementationOnce(() => {
      view.webContents.destroyed = true
      view.webContents.emit('destroyed')
    })
    await manager.close(owner, 'preview-1')
    expect(manager.findOwnedPreview('session-1', 'preview-1')).toBeUndefined()
    expect(() => manager.open(owner, openInput({ ownerKey: 'new-owner' }))).not.toThrow()
  })

  it('drains other views during owner teardown while an explicit close is still pending', async () => {
    const manager = new BrowserPreviewManager()
    const { owner, emitter } = createOwner()
    manager.open(owner, openInput())
    manager.open(owner, openInput({ previewId: 'other-preview' }))
    const view = firstView()
    view.webContents.close.mockImplementationOnce(() => undefined)
    const pending = manager.close(owner, 'preview-1')
    emitter.emit('destroyed')
    expect(view.webContents.close).toHaveBeenCalledOnce()
    expect(manager.findOwnedPreview('session-1', 'preview-1')).toBeDefined()
    expect(manager.findOwnedPreview('session-1', 'other-preview')).toBeUndefined()
    view.webContents.destroyed = true
    view.webContents.emit('destroyed')
    await pending
    expect(manager.listOwnedPreviews('session-1')).toHaveLength(0)
    await manager.close(owner, 'preview-1')
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
