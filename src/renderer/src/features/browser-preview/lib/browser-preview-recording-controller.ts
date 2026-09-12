import type {
  BrowserPreviewRecordingArtifact,
  BrowserPreviewRecordingGrant,
  BrowserPreviewRecordingMimeType,
} from '@shared/types/browser-preview-controls'
import { DEFAULT_BROWSER_PREVIEW_RECORDING_FRAME_RATE } from '@shared/types/browser-preview-controls'
import {
  boundedBrowserPreviewRecordingGrant,
  browserPreviewRecordingBitrate,
  DEFAULT_BROWSER_PREVIEW_RECORDING_ENVIRONMENT,
  describeBrowserPreviewRecordingError,
  selectBrowserPreviewRecordingMimeType,
  stopBrowserPreviewRecordingTracks,
  waitForBrowserPreviewRecorderActive,
} from './browser-preview-recording-runtime'
import type {
  BrowserPreviewRecordingEnvironment,
  BrowserPreviewRecordingOperations,
  BrowserPreviewRecordingSession,
  BrowserPreviewRecordingSnapshot,
} from './browser-preview-recording-types'

export type {
  BrowserPreviewRecordingEnvironment,
  BrowserPreviewRecordingOperations,
  BrowserPreviewRecordingPhase,
  BrowserPreviewRecordingSnapshot,
} from './browser-preview-recording-types'

const RECORDING_TIMESLICE_MS = 1_000

export class BrowserPreviewRecordingController {
  private session: BrowserPreviewRecordingSession | null = null
  private startingPreviewId: string | null = null
  private generation = 0
  private readonly listeners = new Set<() => void>()
  private snapshot: BrowserPreviewRecordingSnapshot = {
    phase: 'idle',
    previewId: null,
    bytes: 0,
    artifact: null,
    error: null,
  }

  constructor(
    private readonly operations: BrowserPreviewRecordingOperations,
    private readonly environment: BrowserPreviewRecordingEnvironment = DEFAULT_BROWSER_PREVIEW_RECORDING_ENVIRONMENT,
    private readonly preferredFrameRate = DEFAULT_BROWSER_PREVIEW_RECORDING_FRAME_RATE,
  ) {}

  getSnapshot = (): BrowserPreviewRecordingSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async start(previewId: string): Promise<void> {
    if (this.session !== null || this.startingPreviewId !== null) {
      throw new Error('A browser preview recording is already active.')
    }
    const generation = ++this.generation
    this.startingPreviewId = previewId
    this.publish({ phase: 'starting', previewId, bytes: 0, artifact: null, error: null })
    let stream: MediaStream | null = null
    try {
      const grant = boundedBrowserPreviewRecordingGrant(await this.operations.begin(previewId))
      if (generation !== this.generation) {
        await this.operations.finish(previewId)
        return
      }
      stream = await this.environment.getDisplayMedia({
        audio: false,
        video: {
          frameRate: {
            ideal: Math.min(grant.maxFrameRate, this.preferredFrameRate),
            max: Math.min(grant.maxFrameRate, this.preferredFrameRate),
          },
        },
      })
      if (generation !== this.generation) {
        stopBrowserPreviewRecordingTracks(stream)
        await this.operations.finish(previewId)
        return
      }
      const mimeType = selectBrowserPreviewRecordingMimeType(this.environment.isTypeSupported)
      const recorder = this.environment.createMediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: browserPreviewRecordingBitrate(
          stream.getVideoTracks()[0]?.getSettings(),
        ),
      })
      const session = this.createSession(previewId, stream, recorder, mimeType, grant)
      this.session = session
      this.startingPreviewId = null
      this.bindSession(session)
      recorder.start(RECORDING_TIMESLICE_MS)
      await waitForBrowserPreviewRecorderActive(recorder, this.environment)
      if (generation !== this.generation || this.session !== session) return
      session.timer = this.environment.setTimer(
        () => this.requestStop(session),
        grant.maxDurationMs,
      )
      this.publish({ phase: 'recording', previewId, bytes: 0, artifact: null, error: null })
    } catch (error) {
      if (stream !== null) stopBrowserPreviewRecordingTracks(stream)
      const active = this.session
      if (active?.previewId === previewId) {
        active.finalized = true
        if (active.timer !== null) this.environment.clearTimer(active.timer)
        this.session = null
      }
      if (this.startingPreviewId === previewId) this.startingPreviewId = null
      await this.operations.finish(previewId).catch(() => undefined)
      if (generation === this.generation) {
        this.publish({
          phase: 'error',
          previewId,
          bytes: 0,
          artifact: null,
          error: describeBrowserPreviewRecordingError(error),
        })
      }
      throw error
    }
  }

  async stop(): Promise<BrowserPreviewRecordingArtifact | null> {
    const session = this.session
    if (session !== null) {
      this.requestStop(session)
      return session.completion
    }
    if (this.startingPreviewId !== null) {
      const previewId = this.startingPreviewId
      this.startingPreviewId = null
      this.generation += 1
      await this.operations.finish(previewId).catch(() => undefined)
      this.publish({ phase: 'idle', previewId: null, bytes: 0, artifact: null, error: null })
    }
    return null
  }

  async cancel(): Promise<void> {
    this.generation += 1
    const session = this.session
    if (session !== null && !session.finalized) {
      session.finalized = true
      if (session.timer !== null) this.environment.clearTimer(session.timer)
      session.timer = null
      this.session = null
      try {
        if (session.recorder.state !== 'inactive') session.recorder.stop()
      } catch {
        // Tracks and the main-process grant are released below even if MediaRecorder is broken.
      }
      stopBrowserPreviewRecordingTracks(session.stream)
      await this.operations.finish(session.previewId).catch(() => undefined)
      session.resolve(null)
    }
    if (this.startingPreviewId !== null) {
      const previewId = this.startingPreviewId
      this.startingPreviewId = null
      this.generation += 1
      await this.operations.finish(previewId).catch(() => undefined)
    }
    this.publish({ phase: 'idle', previewId: null, bytes: 0, artifact: null, error: null })
  }

  async dispose(): Promise<void> {
    await this.cancel()
    this.listeners.clear()
  }

  clearResult(): void {
    if (this.session !== null || this.startingPreviewId !== null) return
    this.publish({ phase: 'idle', previewId: null, bytes: 0, artifact: null, error: null })
  }

  private createSession(
    previewId: string,
    stream: MediaStream,
    recorder: MediaRecorder,
    mimeType: BrowserPreviewRecordingMimeType,
    grant: BrowserPreviewRecordingGrant,
  ): BrowserPreviewRecordingSession {
    let resolve: BrowserPreviewRecordingSession['resolve'] = () => undefined
    let reject: BrowserPreviewRecordingSession['reject'] = () => undefined
    const completion = new Promise<BrowserPreviewRecordingArtifact | null>(
      (onResolve, onReject) => {
        resolve = onResolve
        reject = onReject
      },
    )
    void completion.catch(() => undefined)
    return {
      previewId,
      recorder,
      stream,
      mimeType,
      maxBytes: grant.maxBytes,
      maxDurationMs: grant.maxDurationMs,
      startedAt: this.environment.now(),
      chunks: [],
      completion,
      resolve,
      reject,
      timer: null,
      bytes: 0,
      finalized: false,
    }
  }

  private bindSession(session: BrowserPreviewRecordingSession): void {
    session.recorder.addEventListener('dataavailable', (event) => {
      if (session.finalized || event.data.size === 0) return
      if (session.bytes + event.data.size > session.maxBytes) {
        this.requestStop(session)
        return
      }
      session.chunks.push(event.data)
      session.bytes += event.data.size
      if (this.session === session) {
        this.publish({ ...this.snapshot, bytes: session.bytes })
      }
    })
    session.recorder.addEventListener('stop', () => {
      void this.finalize(session)
    })
    session.recorder.addEventListener('error', () => {
      void this.finalize(session, new Error('Browser preview recording failed.'))
    })
    for (const track of session.stream.getTracks()) {
      track.addEventListener('ended', () => this.requestStop(session), { once: true })
    }
  }

  private requestStop(session: BrowserPreviewRecordingSession): void {
    if (session.finalized || this.session !== session) return
    if (session.timer !== null) this.environment.clearTimer(session.timer)
    session.timer = null
    this.publish({ ...this.snapshot, phase: 'stopping' })
    if (session.recorder.state === 'inactive') {
      void this.finalize(session)
      return
    }
    try {
      session.recorder.stop()
    } catch (error) {
      void this.finalize(session, error instanceof Error ? error : new Error(String(error)))
    }
  }

  private async finalize(session: BrowserPreviewRecordingSession, failure?: Error): Promise<void> {
    if (session.finalized) return
    session.finalized = true
    if (session.timer !== null) this.environment.clearTimer(session.timer)
    session.timer = null
    stopBrowserPreviewRecordingTracks(session.stream)
    let result: BrowserPreviewRecordingArtifact | null = null
    let error = failure
    try {
      if (error === undefined && session.chunks.length > 0) {
        const blob = new Blob(session.chunks, { type: session.mimeType })
        const data = new Uint8Array(await blob.arrayBuffer())
        const durationMs = Math.max(
          1,
          Math.min(Math.round(this.environment.now() - session.startedAt), session.maxDurationMs),
        )
        result = await this.operations.save({
          previewId: session.previewId,
          mimeType: session.mimeType,
          data,
          durationMs,
        })
      }
    } catch (cause) {
      error = cause instanceof Error ? cause : new Error(String(cause))
    } finally {
      await this.operations.finish(session.previewId).catch((cause: unknown) => {
        error ??= cause instanceof Error ? cause : new Error(String(cause))
      })
    }
    if (this.session === session) this.session = null
    if (error !== undefined) {
      this.publish({
        phase: 'error',
        previewId: session.previewId,
        bytes: session.bytes,
        artifact: null,
        error: error.message,
      })
      session.reject(error)
      return
    }
    this.publish({
      phase: 'idle',
      previewId: null,
      bytes: 0,
      artifact: result,
      error: null,
    })
    session.resolve(result)
  }

  private publish(snapshot: BrowserPreviewRecordingSnapshot): void {
    this.snapshot = snapshot
    for (const listener of this.listeners) listener()
  }
}
