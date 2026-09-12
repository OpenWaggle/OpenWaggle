import type { BrowserPreviewRecordingArtifact } from '@shared/types/browser-preview-controls'
import type {
  BrowserPreviewRecordingCancelRequest,
  BrowserPreviewRecordingRequest,
} from '@shared/types/browser-preview-recording-request'
import { fromPartial } from '@total-typescript/shoehorn'
import type { WebContents } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserPreviewRecordingRequestBroker } from '../browser-preview-recording-request-broker'
import type { BrowserPreviewRecord } from '../browser-preview-records'

const artifact: BrowserPreviewRecordingArtifact = {
  id: 'recording-1',
  previewId: 'preview-1',
  path: '/private/browser-preview.webm',
  mimeType: 'video/webm;codecs=vp9',
  sizeBytes: 1_024,
  durationMs: 500,
  createdAt: '2026-09-05T10:00:00.000Z',
}

function makeFixture() {
  let request: BrowserPreviewRecordingRequest | null = null
  const cancellations: BrowserPreviewRecordingCancelRequest[] = []
  const send = vi.fn(
    (
      channel: string,
      payload: BrowserPreviewRecordingRequest | BrowserPreviewRecordingCancelRequest,
    ) => {
      if (channel === 'browser-preview:recording-request' && 'action' in payload) request = payload
      if (channel === 'browser-preview:recording-cancel' && 'reason' in payload) {
        cancellations.push(payload)
      }
    },
  )
  const sender = fromPartial<WebContents>({ id: 42, isDestroyed: () => false, send })
  const contents = fromPartial<WebContents>({ isDestroyed: () => false })
  const record = fromPartial<BrowserPreviewRecord>({
    previewId: 'preview-1',
    disposed: false,
    owner: { sender },
    view: { webContents: contents },
  })
  return {
    broker: new BrowserPreviewRecordingRequestBroker(),
    cancellations,
    currentRequest: () => request,
    record,
    send,
    sender,
  }
}

function requireRequest(
  request: BrowserPreviewRecordingRequest | null,
): BrowserPreviewRecordingRequest {
  if (request === null) throw new Error('Expected a recording request to be sent.')
  return request
}

afterEach(() => {
  vi.useRealTimers()
})

describe('BrowserPreviewRecordingRequestBroker', () => {
  it('settles start only after the exact owner acknowledges an active recorder', async () => {
    const fixture = makeFixture()
    let settled = false
    const started = fixture.broker.start(fixture.record).then(() => {
      settled = true
    })
    await Promise.resolve()
    const request = requireRequest(fixture.currentRequest())

    expect(settled).toBe(false)
    fixture.broker.respond(fixture.sender, {
      requestId: request.requestId,
      previewId: request.previewId,
      status: 'started',
    })
    await started

    expect(settled).toBe(true)
  })

  it('returns a stop artifact only after renderer persistence completes', async () => {
    const fixture = makeFixture()
    const stopped = fixture.broker.stop(fixture.record)
    const request = requireRequest(fixture.currentRequest())

    fixture.broker.respond(fixture.sender, {
      requestId: request.requestId,
      previewId: request.previewId,
      status: 'stopped',
      artifact,
    })

    await expect(stopped).resolves.toEqual(artifact)
  })

  it('rejects spoofed sender identity without consuming the real request', async () => {
    const fixture = makeFixture()
    const started = fixture.broker.start(fixture.record)
    const request = requireRequest(fixture.currentRequest())
    const otherSender = fromPartial<WebContents>({ id: 99 })

    expect(() =>
      fixture.broker.respond(otherSender, {
        requestId: request.requestId,
        previewId: request.previewId,
        status: 'started',
      }),
    ).toThrow('identity')

    fixture.broker.respond(fixture.sender, {
      requestId: request.requestId,
      previewId: request.previewId,
      status: 'started',
    })
    await expect(started).resolves.toBeUndefined()
  })

  it('allows only one pending action for a canonical owner and preview pair', async () => {
    const fixture = makeFixture()
    const started = fixture.broker.start(fixture.record)
    const request = requireRequest(fixture.currentRequest())

    await expect(fixture.broker.stop(fixture.record)).rejects.toThrow('already pending')

    fixture.broker.respond(fixture.sender, {
      requestId: request.requestId,
      previewId: request.previewId,
      status: 'started',
    })
    await started
  })

  it('times out within the requested bound and sends a matching cancellation', async () => {
    vi.useFakeTimers()
    const fixture = makeFixture()
    const started = fixture.broker.start(fixture.record, { timeoutMs: 25 })
    const request = requireRequest(fixture.currentRequest())
    const rejected = expect(started).rejects.toThrow('timed out')

    await vi.advanceTimersByTimeAsync(25)

    await rejected
    expect(fixture.cancellations).toEqual([
      { requestId: request.requestId, previewId: request.previewId, reason: 'timeout' },
    ])
  })

  it('settles an aborted request and notifies the renderer to stop capture', async () => {
    const fixture = makeFixture()
    const cancellation = new AbortController()
    const started = fixture.broker.start(fixture.record, { signal: cancellation.signal })
    const request = requireRequest(fixture.currentRequest())
    const rejected = expect(started).rejects.toThrow('aborted')

    cancellation.abort()

    await rejected
    expect(fixture.cancellations).toEqual([
      { requestId: request.requestId, previewId: request.previewId, reason: 'aborted' },
    ])
  })

  it('cancels and settles a pending action when the preview closes', async () => {
    const fixture = makeFixture()
    const stopped = fixture.broker.stop(fixture.record)
    const request = requireRequest(fixture.currentRequest())
    const rejected = expect(stopped).rejects.toThrow('closed')

    fixture.broker.dispose(fixture.record)

    await rejected
    expect(fixture.cancellations).toEqual([
      { requestId: request.requestId, previewId: request.previewId, reason: 'preview-closed' },
    ])
  })
})
