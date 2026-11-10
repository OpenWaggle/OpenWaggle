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

function fixture() {
  const manager = new BrowserPreviewManager()
  const { owner, emitter } = createOwner()
  getBrowserPreviewElectronMocks().windowFromWebContents.mockReturnValue(createWindow().window)
  manager.open(owner, openInput())
  return { manager, owner, emitter, view: firstView() }
}

describe('autonomous retired preview cleanup', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    getBrowserPreviewElectronMocks().createdViews.splice(0)
    getBrowserPreviewOwnerRegistryMock().assertRegistered.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('retries a retirement-first close failure without any request from the retired renderer', async () => {
    const { manager, owner, emitter, view } = fixture()
    view.webContents.close.mockImplementationOnce(() => {
      throw new Error('Native close failed')
    })
    emitter.emit('render-process-gone', {}, { reason: 'crashed' })
    expect(view.webContents.destroyed).toBe(false)
    expect(() => manager.open(owner, openInput())).toThrow('cleanup is pending')
    await vi.advanceTimersByTimeAsync(250)
    expect(view.webContents.close).toHaveBeenCalledTimes(2)
    expect(view.webContents.destroyed).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('automatically retries a previously failed explicit close after retirement', async () => {
    const { manager, owner, emitter, view } = fixture()
    view.webContents.close.mockImplementationOnce(() => {
      throw new Error('User close failed')
    })
    await expect(manager.close(owner, 'preview-1')).rejects.toThrow('User close failed')
    view.webContents.close.mockImplementationOnce(() => {
      throw new Error('Retired close failed')
    })
    emitter.emit('destroyed')
    await vi.advanceTimersByTimeAsync(250)
    expect(view.webContents.close).toHaveBeenCalledTimes(3)
    expect(view.webContents.destroyed).toBe(true)
  })

  it('joins an already pending close and retries automatically after its deadline', async () => {
    const { manager, owner, emitter, view } = fixture()
    view.webContents.close.mockImplementationOnce(() => undefined)
    const pending = manager.close(owner, 'preview-1')
    const timedOut = expect(pending).rejects.toThrow('deadline')
    emitter.emit('render-process-gone', {}, { reason: 'crashed' })
    expect(view.webContents.close).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(2_000)
    await timedOut
    expect(view.webContents.destroyed).toBe(false)
    await vi.advanceTimersByTimeAsync(250)
    expect(view.webContents.close).toHaveBeenCalledTimes(2)
    expect(view.webContents.destroyed).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('backs off repeated failures, caps the interval and leaves timers unreferenced', async () => {
    const { emitter, view } = fixture()
    const timers = vi.spyOn(globalThis, 'setTimeout')
    view.webContents.close.mockImplementation(() => {
      throw new Error('Still unavailable')
    })
    emitter.emit('destroyed')
    await vi.advanceTimersByTimeAsync(249)
    expect(view.webContents.close).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    expect(view.webContents.close).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(499)
    expect(view.webContents.close).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(view.webContents.close).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(119_250)
    expect(view.webContents.close.mock.calls.length).toBeLessThanOrEqual(11)
    const attempts = view.webContents.close.mock.calls.length
    await vi.advanceTimersByTimeAsync(30_000)
    expect(view.webContents.close).toHaveBeenCalledTimes(attempts + 1)
    expect(vi.getTimerCount()).toBe(1)
    for (const result of timers.mock.results) {
      if (result.type === 'return') expect(result.value.hasRef()).toBe(false)
    }
    view.webContents.destroyed = true
    view.webContents.emit('destroyed')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels backoff when native destruction happens between retries', async () => {
    const { emitter, view } = fixture()
    view.webContents.close.mockImplementation(() => {
      throw new Error('close failed')
    })
    emitter.emit('destroyed')
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(1)
    view.webContents.destroyed = true
    view.webContents.emit('destroyed')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(view.webContents.close).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not resurrect a retry when destruction precedes the close rejection handler', async () => {
    const { emitter, view } = fixture()
    view.webContents.close.mockImplementation(() => {
      throw new Error('close failed')
    })
    emitter.emit('destroyed')
    view.webContents.destroyed = true
    view.webContents.emit('destroyed')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(view.webContents.close).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not automatically retry an ordinary failed user close while its owner stays live', async () => {
    const { manager, owner, view } = fixture()
    view.webContents.close.mockImplementationOnce(() => {
      throw new Error('User close failed')
    })
    await expect(manager.close(owner, 'preview-1')).rejects.toThrow('User close failed')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(view.webContents.close).toHaveBeenCalledOnce()
    expect(manager.findOwnedPreview('session-1', 'preview-1')).toBeDefined()
    expect(vi.getTimerCount()).toBe(0)
    await manager.close(owner, 'preview-1')
  })
})
