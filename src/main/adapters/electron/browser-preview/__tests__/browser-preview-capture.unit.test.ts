import { fromPartial } from '@total-typescript/shoehorn'
import type { NativeImage, WebContents } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BrowserPreviewCaptureTimeoutError,
  captureBrowserPreviewPage,
} from '../browser-preview-capture'

function capturedImage() {
  return fromPartial<NativeImage>({ isEmpty: () => false })
}

function captureTarget(capturePage: WebContents['capturePage']) {
  return fromPartial<WebContents>({
    capturePage,
    invalidate: vi.fn(),
    isDestroyed: () => false,
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('captureBrowserPreviewPage', () => {
  it('retries transient native failures after the compositor delay', async () => {
    vi.useFakeTimers()
    const image = capturedImage()
    const capturePage = vi
      .fn<WebContents['capturePage']>()
      .mockRejectedValueOnce(new Error('UnknownVizError'))
      .mockRejectedValueOnce(new Error('UnknownVizError'))
      .mockResolvedValue(image)
    const contents = captureTarget(capturePage)

    const pending = captureBrowserPreviewPage(contents)
    await vi.advanceTimersByTimeAsync(240)

    await expect(pending).resolves.toBe(image)
    expect(capturePage).toHaveBeenCalledTimes(3)
  })

  it('bounds a stalled capture without starting overlapping native captures', async () => {
    vi.useFakeTimers()
    let activeCaptures = 0
    let maximumActiveCaptures = 0
    const capturePage = vi.fn<WebContents['capturePage']>(() => {
      activeCaptures += 1
      maximumActiveCaptures = Math.max(maximumActiveCaptures, activeCaptures)
      return new Promise<NativeImage>(() => undefined)
    })
    const contents = captureTarget(capturePage)

    const first = captureBrowserPreviewPage(contents)
    const second = captureBrowserPreviewPage(contents)
    const firstResult = expect(first).rejects.toBeInstanceOf(BrowserPreviewCaptureTimeoutError)
    const secondResult = expect(second).rejects.toBeInstanceOf(BrowserPreviewCaptureTimeoutError)
    await vi.advanceTimersByTimeAsync(3_500)

    await firstResult
    await secondResult
    expect(capturePage).toHaveBeenCalledOnce()
    expect(maximumActiveCaptures).toBe(1)
    expect(contents.invalidate).toHaveBeenCalledTimes(4)
  })

  it('accepts a stalled native capture that settles during a later bounded attempt', async () => {
    vi.useFakeTimers()
    const image = capturedImage()
    let settleCapture: ((image: NativeImage) => void) | undefined
    const capturePage = vi.fn<WebContents['capturePage']>(
      () =>
        new Promise<NativeImage>((resolve) => {
          settleCapture = resolve
        }),
    )
    const contents = captureTarget(capturePage)
    const pending = captureBrowserPreviewPage(contents)

    await vi.advanceTimersByTimeAsync(1_120)
    settleCapture?.(image)

    await expect(pending).resolves.toBe(image)
    expect(capturePage).toHaveBeenCalledOnce()
    expect(contents.invalidate).toHaveBeenCalledOnce()
  })

  it('does not invoke a queued native capture after its current-page guard is revoked', async () => {
    vi.useFakeTimers()
    const firstCapture = new Promise<NativeImage>(() => undefined)
    const capturePage = vi
      .fn<WebContents['capturePage']>()
      .mockImplementationOnce(() => firstCapture)
      .mockResolvedValue(capturedImage())
    const contents = captureTarget(capturePage)
    let current = true

    const first = captureBrowserPreviewPage(contents)
    const queued = captureBrowserPreviewPage(contents, {
      assertCurrent: () => {
        if (!current) throw new Error('Browser preview document changed.')
      },
    })
    const firstResult = expect(first).rejects.toBeInstanceOf(BrowserPreviewCaptureTimeoutError)
    const queuedResult = expect(queued).rejects.toThrow('document changed')
    await vi.advanceTimersByTimeAsync(1_000)
    current = false
    await vi.advanceTimersByTimeAsync(2_500)

    await firstResult
    await queuedResult
    expect(capturePage).toHaveBeenCalledOnce()
  })

  it('aborts its bounded wait without leaving a queued native call behind', async () => {
    const capturePage = vi.fn<WebContents['capturePage']>(() => new Promise(() => undefined))
    const contents = captureTarget(capturePage)
    const abortController = new AbortController()
    const pending = captureBrowserPreviewPage(contents, { signal: abortController.signal })
    await vi.waitFor(() => expect(capturePage).toHaveBeenCalledOnce())

    abortController.abort()

    await expect(pending).rejects.toThrow('cancelled')
  })
})
