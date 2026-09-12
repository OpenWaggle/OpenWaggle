import type {
  BrowserPreviewRecordingFrameRate,
  BrowserPreviewRecordingGrant,
} from '@shared/types/browser-preview-controls'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BrowserPreviewRecordingController,
  type BrowserPreviewRecordingEnvironment,
  type BrowserPreviewRecordingOperations,
} from '../browser-preview-recording-controller'

interface RecorderFixture {
  readonly activate: () => void
  readonly dispatchData: (contents: string) => void
  readonly recorder: globalThis.MediaRecorder
  readonly setActivatesOnStart: (active: boolean) => void
  readonly start: ReturnType<typeof vi.fn>
  readonly stop: ReturnType<typeof vi.fn>
  readonly trackStop: ReturnType<typeof vi.fn>
}

function makeRecorder(): RecorderFixture {
  const eventTarget = new EventTarget()
  let state: RecordingState = 'inactive'
  let activatesOnStart = true
  const start = vi.fn(() => {
    if (activatesOnStart) state = 'recording'
  })
  const stop = vi.fn(() => {
    state = 'inactive'
    eventTarget.dispatchEvent(new Event('stop'))
  })
  const trackStop = vi.fn()
  const trackTarget = new EventTarget()
  const track = fromPartial<globalThis.MediaStreamTrack>({
    addEventListener: trackTarget.addEventListener.bind(trackTarget),
    stop: trackStop,
    getSettings: () => ({ width: 1_920, height: 1_080, frameRate: 30 }),
  })
  const stream = fromPartial<globalThis.MediaStream>({
    getTracks: () => [track],
    getVideoTracks: () => [track],
  })
  const recorder = fromPartial<globalThis.MediaRecorder>({
    addEventListener: eventTarget.addEventListener.bind(eventTarget),
    removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
    get state() {
      return state
    },
    start,
    stop,
    stream,
  })
  return {
    activate: () => {
      state = 'recording'
      eventTarget.dispatchEvent(new Event('start'))
    },
    dispatchData: (contents) => {
      const event = new Event('dataavailable')
      Object.defineProperty(event, 'data', { value: new Blob([contents]) })
      eventTarget.dispatchEvent(event)
    },
    recorder,
    setActivatesOnStart: (active) => {
      activatesOnStart = active
    },
    start,
    stop,
    trackStop,
  }
}

function makeFixture(
  grant: BrowserPreviewRecordingGrant = {
    maxBytes: 1_024,
    maxDurationMs: 5_000,
    maxFrameRate: 24,
  },
  preferredFrameRate: BrowserPreviewRecordingFrameRate = 30,
) {
  const recorder = makeRecorder()
  let now = 100
  const createMediaRecorder = vi.fn(() => recorder.recorder)
  const getDisplayMedia = vi.fn(async () => recorder.recorder.stream)
  const operations: BrowserPreviewRecordingOperations = {
    begin: vi.fn(async () => grant),
    finish: vi.fn(async () => undefined),
    save: vi.fn(async (input) => ({
      id: 'recording-1',
      previewId: input.previewId,
      path: '/private/browser-recording.webm',
      mimeType: input.mimeType,
      sizeBytes: input.data.byteLength,
      durationMs: input.durationMs,
      createdAt: '2026-09-05T10:00:00.000Z',
    })),
  }
  const environment: BrowserPreviewRecordingEnvironment = {
    getDisplayMedia,
    createMediaRecorder,
    isTypeSupported: (mimeType) => mimeType === 'video/webm;codecs=vp9',
    now: () => now,
    setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimer: (timer) => clearTimeout(timer),
  }
  return {
    controller: new BrowserPreviewRecordingController(operations, environment, preferredFrameRate),
    createMediaRecorder,
    getDisplayMedia,
    operations,
    recorder,
    setNow: (value: number) => {
      now = value
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('BrowserPreviewRecordingController', () => {
  it('arms exact-tab capture and chooses the best supported bounded format', async () => {
    const fixture = makeFixture()

    await fixture.controller.start('preview-1')

    expect(fixture.operations.begin).toHaveBeenCalledExactlyOnceWith('preview-1')
    expect(fixture.getDisplayMedia).toHaveBeenCalledWith({
      audio: false,
      video: { frameRate: { ideal: 24, max: 24 } },
    })
    expect(fixture.createMediaRecorder).toHaveBeenCalledWith(fixture.recorder.recorder.stream, {
      mimeType: 'video/webm;codecs=vp9',
      videoBitsPerSecond: 3_110_400,
    })
    expect(fixture.recorder.start).toHaveBeenCalledExactlyOnceWith(1_000)
    expect(fixture.controller.getSnapshot()).toMatchObject({
      phase: 'recording',
      previewId: 'preview-1',
      bytes: 0,
    })

    await fixture.controller.stop()
  })

  it('requests the persisted 60 FPS preference when the main-process grant permits it', async () => {
    const fixture = makeFixture({ maxBytes: 1_024, maxDurationMs: 5_000, maxFrameRate: 60 }, 60)

    await fixture.controller.start('preview-1')

    expect(fixture.getDisplayMedia).toHaveBeenCalledWith({
      audio: false,
      video: { frameRate: { ideal: 60, max: 60 } },
    })
    await fixture.controller.stop()
  })

  it('saves collected bytes once and always releases the main-process grant', async () => {
    const fixture = makeFixture()
    await fixture.controller.start('preview-1')
    fixture.recorder.dispatchData('frame-data')
    fixture.setNow(1_600)

    const artifact = await fixture.controller.stop()

    expect(artifact).toMatchObject({ previewId: 'preview-1', sizeBytes: 10, durationMs: 1_500 })
    expect(fixture.operations.save).toHaveBeenCalledOnce()
    expect(fixture.operations.save).toHaveBeenCalledWith(
      expect.objectContaining({
        previewId: 'preview-1',
        mimeType: 'video/webm;codecs=vp9',
        durationMs: 1_500,
      }),
    )
    expect(fixture.operations.finish).toHaveBeenCalledExactlyOnceWith('preview-1')
    expect(fixture.recorder.trackStop).toHaveBeenCalledOnce()
    expect(fixture.controller.getSnapshot()).toMatchObject({ phase: 'idle', artifact })
  })

  it('stops before retaining a chunk that would exceed the byte grant', async () => {
    const fixture = makeFixture({ maxBytes: 3, maxDurationMs: 5_000, maxFrameRate: 30 })
    await fixture.controller.start('preview-1')
    fixture.recorder.dispatchData('ab')

    fixture.recorder.dispatchData('cd')

    await vi.waitFor(() => expect(fixture.operations.save).toHaveBeenCalledOnce())
    const saved = vi.mocked(fixture.operations.save).mock.calls[0]?.[0]
    expect(saved?.data).toEqual(new Uint8Array([97, 98]))
    expect(fixture.recorder.stop).toHaveBeenCalledOnce()
  })

  it('auto-stops at the granted duration without polling or overlapping timers', async () => {
    vi.useFakeTimers()
    const fixture = makeFixture({ maxBytes: 1_024, maxDurationMs: 250, maxFrameRate: 30 })
    await fixture.controller.start('preview-1')
    fixture.recorder.dispatchData('a')
    fixture.setNow(350)

    await vi.advanceTimersByTimeAsync(250)

    expect(fixture.recorder.stop).toHaveBeenCalledOnce()
    expect(fixture.operations.save).toHaveBeenCalledOnce()
  })

  it('fails closed when the runtime reports unusable recording limits', async () => {
    const fixture = makeFixture({
      maxBytes: Number.POSITIVE_INFINITY,
      maxDurationMs: 250,
      maxFrameRate: 30,
    })

    await expect(fixture.controller.start('preview-1')).rejects.toThrow('positive finite')

    expect(fixture.getDisplayMedia).not.toHaveBeenCalled()
    expect(fixture.operations.finish).toHaveBeenCalledWith('preview-1')
    expect(fixture.controller.getSnapshot().phase).toBe('error')
  })

  it('does not acknowledge a recorder that failed to enter the recording state', async () => {
    vi.useFakeTimers()
    const fixture = makeFixture()
    fixture.recorder.setActivatesOnStart(false)
    const starting = fixture.controller.start('preview-1')
    const rejected = expect(starting).rejects.toThrow('active state')

    await vi.advanceTimersByTimeAsync(1_000)

    await rejected

    expect(fixture.operations.save).not.toHaveBeenCalled()
    expect(fixture.operations.finish).toHaveBeenCalledWith('preview-1')
    expect(fixture.recorder.trackStop).toHaveBeenCalledOnce()
  })

  it('waits for an asynchronous MediaRecorder start event before reporting active', async () => {
    const fixture = makeFixture()
    fixture.recorder.setActivatesOnStart(false)
    const starting = fixture.controller.start('preview-1')
    await vi.waitFor(() => expect(fixture.recorder.start).toHaveBeenCalledOnce())

    fixture.recorder.activate()
    await starting

    expect(fixture.controller.getSnapshot()).toMatchObject({
      phase: 'recording',
      previewId: 'preview-1',
    })
    await fixture.controller.cancel()
  })

  it('cancels without persisting partial bytes and settles an active stop waiter', async () => {
    const fixture = makeFixture()
    await fixture.controller.start('preview-1')
    fixture.recorder.dispatchData('partial-frame')

    await fixture.controller.cancel()
    const stopped = await fixture.controller.stop()

    expect(stopped).toBeNull()
    expect(fixture.operations.save).not.toHaveBeenCalled()
    expect(fixture.operations.finish).toHaveBeenCalledExactlyOnceWith('preview-1')
    expect(fixture.recorder.trackStop).toHaveBeenCalledOnce()
    expect(fixture.controller.getSnapshot()).toMatchObject({ phase: 'idle', previewId: null })
  })

  it('stops a display stream that arrives after a pending start was cancelled', async () => {
    const fixture = makeFixture()
    let releaseDisplay: () => void = () => undefined
    const display = new Promise<MediaStream>((resolve) => {
      releaseDisplay = () => resolve(fixture.recorder.recorder.stream)
    })
    fixture.getDisplayMedia.mockReturnValueOnce(display)
    const starting = fixture.controller.start('preview-1')
    await vi.waitFor(() => expect(fixture.getDisplayMedia).toHaveBeenCalledOnce())

    await fixture.controller.cancel()
    releaseDisplay()
    await starting

    expect(fixture.recorder.trackStop).toHaveBeenCalledOnce()
    expect(fixture.recorder.start).not.toHaveBeenCalled()
    expect(fixture.controller.getSnapshot()).toMatchObject({ phase: 'idle', previewId: null })
  })
})
