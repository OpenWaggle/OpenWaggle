import type { BrowserPreviewRecordingArtifact } from '@shared/types/browser-preview-controls'
import { describe, expect, it, vi } from 'vitest'
import { BrowserPreviewRecordingRequestClient } from '../browser-preview-recording-request-client'

const artifact: BrowserPreviewRecordingArtifact = {
  id: 'recording-1',
  previewId: 'preview-1',
  path: '/private/browser-preview.webm',
  mimeType: 'video/webm;codecs=vp9',
  sizeBytes: 1_024,
  durationMs: 500,
  createdAt: '2026-09-05T10:00:00.000Z',
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((onResolve) => {
    resolve = onResolve
  })
  return { promise, resolve }
}

function makeClient() {
  const start = vi.fn(async (): Promise<void> => undefined)
  const cancel = vi.fn(async (): Promise<void> => undefined)
  const controller = {
    start,
    stop: vi.fn(async () => artifact),
    cancel,
  }
  const respond = vi.fn(async () => undefined)
  return {
    client: new BrowserPreviewRecordingRequestClient('preview-1', controller, respond),
    controller,
    respond,
  }
}

describe('BrowserPreviewRecordingRequestClient', () => {
  it('acknowledges start only after the recorder reports itself active', async () => {
    const fixture = makeClient()
    const active = deferred()
    fixture.controller.start.mockReturnValueOnce(active.promise)

    const handling = fixture.client.handle({
      requestId: 'request-1',
      previewId: 'preview-1',
      action: 'start',
    })
    await Promise.resolve()

    expect(fixture.respond).not.toHaveBeenCalled()
    active.resolve()
    await handling
    expect(fixture.respond).toHaveBeenCalledExactlyOnceWith({
      requestId: 'request-1',
      previewId: 'preview-1',
      status: 'started',
    })
  })

  it('acknowledges stop only after the persisted artifact is available', async () => {
    const fixture = makeClient()

    await fixture.client.handle({
      requestId: 'request-2',
      previewId: 'preview-1',
      action: 'stop',
    })

    expect(fixture.respond).toHaveBeenCalledExactlyOnceWith({
      requestId: 'request-2',
      previewId: 'preview-1',
      status: 'stopped',
      artifact,
    })
  })

  it('cancels an in-flight request without sending a stale acknowledgement', async () => {
    const fixture = makeClient()
    const active = deferred()
    fixture.controller.start.mockReturnValueOnce(active.promise)
    const handling = fixture.client.handle({
      requestId: 'request-3',
      previewId: 'preview-1',
      action: 'start',
    })
    await Promise.resolve()

    await fixture.client.cancel({
      requestId: 'request-3',
      previewId: 'preview-1',
      reason: 'timeout',
    })
    active.resolve()
    await handling

    expect(fixture.controller.cancel).toHaveBeenCalledOnce()
    expect(fixture.respond).not.toHaveBeenCalled()
  })

  it('fails a second action while one request is pending', async () => {
    const fixture = makeClient()
    const active = deferred()
    fixture.controller.start.mockReturnValueOnce(active.promise)
    const first = fixture.client.handle({
      requestId: 'request-4',
      previewId: 'preview-1',
      action: 'start',
    })
    await Promise.resolve()

    await fixture.client.handle({
      requestId: 'request-5',
      previewId: 'preview-1',
      action: 'stop',
    })

    expect(fixture.respond).toHaveBeenCalledWith({
      requestId: 'request-5',
      previewId: 'preview-1',
      status: 'failed',
      error: 'A browser preview recording action is already pending.',
    })
    active.resolve()
    await first
  })

  it('ignores requests and cancellation for another preview', async () => {
    const fixture = makeClient()

    await fixture.client.handle({
      requestId: 'request-6',
      previewId: 'preview-2',
      action: 'start',
    })
    await fixture.client.cancel({
      requestId: null,
      previewId: 'preview-2',
      reason: 'preview-closed',
    })

    expect(fixture.controller.start).not.toHaveBeenCalled()
    expect(fixture.controller.cancel).not.toHaveBeenCalled()
    expect(fixture.respond).not.toHaveBeenCalled()
  })
})
