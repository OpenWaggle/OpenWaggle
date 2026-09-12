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

function setup() {
  const { owner, emitter } = createOwner()
  electronMocks.windowFromWebContents.mockReturnValue(createWindow().window)
  const manager = new BrowserPreviewManager()
  manager.open(owner, openInput())
  return { owner, emitter, manager, view: firstView() }
}

describe('acknowledged browser preview cleanup', () => {
  beforeEach(() => {
    electronMocks.createdViews.splice(0)
    electronMocks.windowFromWebContents.mockReset()
    getBrowserPreviewOwnerRegistryMock().assertRegistered.mockReset()
    getBrowserPreviewOwnerRegistryMock().notifyMaterialized.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('waits for exact native destruction and leaves other owners untouched', async () => {
    const { owner, manager, view } = setup()
    manager.open(owner, openInput({ previewId: 'other', ownerKey: 'session-2' }))
    view.webContents.close.mockImplementationOnce(() => undefined)
    const finished = vi.fn()
    const closing = manager.closeForOwner('session-1').then(finished)

    await Promise.resolve()
    expect(finished).not.toHaveBeenCalled()
    expect(manager.listOwnedPreviews('session-1')).toHaveLength(0)
    expect(manager.listOwnedPreviews('session-2')).toHaveLength(1)
    expect(() => manager.open(owner, openInput())).toThrow('closing')

    view.webContents.destroyed = true
    view.webContents.emit('destroyed')
    await closing
    expect(finished).toHaveBeenCalledOnce()
    expect(electronMocks.createdViews[1]?.webContents.close).not.toHaveBeenCalled()
  })

  it('does not lose a failed native close when the visible registry is empty', async () => {
    const { owner, manager, view } = setup()
    view.webContents.close.mockImplementationOnce(() => {
      throw new Error('native close failed')
    })
    manager.close(owner, 'preview-1')
    expect(manager.listOwnedPreviews('session-1')).toHaveLength(0)
    expect(view.webContents.destroyed).toBe(false)

    await manager.closeForOwner('session-1')
    expect(view.webContents.close).toHaveBeenCalledTimes(2)
    expect(view.webContents.destroyed).toBe(true)
  })

  it('rejects native close failures and preserves the exact resource for retry', async () => {
    const { manager, view } = setup()
    view.webContents.close.mockImplementationOnce(() => {
      throw new Error('native close failed')
    })
    await expect(manager.closeForOwner('session-1')).rejects.toThrow('native close failed')
    expect(view.webContents.destroyed).toBe(false)
    await manager.closeForOwner('session-1')
    expect(view.webContents.destroyed).toBe(true)
  })

  it('times out without proving disposal and can retry the retained contents', async () => {
    vi.useFakeTimers()
    const { manager, view } = setup()
    view.webContents.close.mockImplementationOnce(() => undefined)
    const closing = expect(manager.closeForOwner('session-1')).rejects.toThrow('did not close')
    await vi.advanceTimersByTimeAsync(5_000)
    await closing
    expect(view.webContents.destroyed).toBe(false)

    await manager.closeForOwner('session-1')
    expect(view.webContents.destroyed).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retries orphaned contents after their renderer owner has gone', async () => {
    const { emitter, manager, view } = setup()
    view.webContents.close.mockImplementationOnce(() => {
      throw new Error('owner teardown close failed')
    })
    emitter.emit('destroyed')
    expect(manager.listOwnedPreviews('session-1')).toHaveLength(0)
    await manager.closeAll()
    expect(view.webContents.destroyed).toBe(true)
  })

  it('tracks a partially configured view even when its initial cleanup fails', async () => {
    const { owner } = createOwner()
    electronMocks.windowFromWebContents.mockReturnValue(createWindow().window)
    const manager = new BrowserPreviewManager()
    const push = electronMocks.createdViews.push.bind(electronMocks.createdViews)
    vi.spyOn(electronMocks.createdViews, 'push').mockImplementationOnce((view) => {
      const count = push(view)
      view.webContents.setZoomFactor.mockImplementationOnce(() => {
        throw new Error('setup failed')
      })
      view.webContents.close.mockImplementationOnce(() => {
        throw new Error('partial cleanup failed')
      })
      return count
    })
    expect(() => manager.open(owner, openInput())).toThrow('setup failed')
    expect(manager.listOwnedPreviews('session-1')).toHaveLength(0)

    manager.open(owner, openInput({ ownerKey: 'session-2' }))
    await manager.closeForOwner('session-1')
    expect(firstView().webContents.destroyed).toBe(true)
    expect(electronMocks.createdViews[1]?.webContents.close).not.toHaveBeenCalled()
    expect(() => manager.reload(owner, 'preview-1')).not.toThrow()
    expect(manager.listOwnedPreviews('session-2')).toHaveLength(1)
    await manager.closeAll()
  })

  it('gates open and replacement before shutdown and keeps the gate after failure', async () => {
    const { owner, manager, view } = setup()
    manager.beginShutdown()
    expect(() => manager.open(owner, openInput({ previewId: 'new' }))).toThrow('shutting down')
    expect(() =>
      manager.replaceForCapacity(owner, openInput({ previewId: 'new' }), 'preview-1'),
    ).toThrow('shutting down')
    view.webContents.close.mockImplementationOnce(() => {
      throw new Error('native shutdown failure')
    })
    await expect(manager.closeAll()).rejects.toThrow('native shutdown failure')
    expect(() => manager.open(owner, openInput())).toThrow('shutting down')
    await manager.closeAll()
    expect(view.webContents.destroyed).toBe(true)
  })
})
