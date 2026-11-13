import { safeDecodeUnknown } from '@shared/schema'
import {
  browserPreviewArtifactPathSchema,
  browserPreviewIdAndAppearanceSchema,
  browserPreviewIdAndAudioMutedSchema,
  browserPreviewIdAndViewportSchema,
  browserPreviewIdSchema,
  browserPreviewRecordingInputSchema,
  browserPreviewReplacementInputSchema,
} from '@shared/schemas/browser-preview'
import { browserPreviewRecordingRequestResponseSchema } from '@shared/schemas/browser-preview-recording-request'
import * as Effect from 'effect/Effect'
import type { Schema as EffectSchema } from 'effect/Schema'
import { browserPreviewViews } from '../desktop-shell/browser-preview-views'
import { requireBrowserEngineEffect } from './browser-engine-handler'
import { typedHandle } from './typed-ipc'

function decode<T, I>(schema: EffectSchema<T, I>, value: unknown) {
  const decoded = safeDecodeUnknown(schema, value)
  return decoded.success
    ? Effect.succeed(decoded.data)
    : Effect.fail(new Error(decoded.issues.join('; ')))
}

function registerBrowserPreviewDisplayControlHandlers() {
  typedHandle('browser-preview:respond-recording-request', (event, response: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* decode(browserPreviewRecordingRequestResponseSchema, response)
      yield* Effect.sync(() => browserPreviewViews.respondToRecordingRequest(event.sender, decoded))
    }),
  )

  typedHandle('browser-preview:set-viewport', (event, previewId: unknown, viewport: unknown) =>
    Effect.gen(function* () {
      const [id, decodedViewport] = yield* decode(browserPreviewIdAndViewportSchema, [
        previewId,
        viewport,
      ])
      return yield* Effect.sync(() =>
        browserPreviewViews.setViewport(event.sender, id, decodedViewport),
      )
    }),
  )

  typedHandle('browser-preview:hard-reload', (event, previewId: unknown) =>
    Effect.gen(function* () {
      const id = yield* decode(browserPreviewIdSchema, previewId)
      return yield* Effect.sync(() => browserPreviewViews.hardReload(event.sender, id))
    }),
  )

  typedHandle('browser-preview:set-appearance', (event, previewId: unknown, appearance: unknown) =>
    Effect.gen(function* () {
      const [id, decodedAppearance] = yield* decode(browserPreviewIdAndAppearanceSchema, [
        previewId,
        appearance,
      ])
      return yield* Effect.tryPromise(() =>
        browserPreviewViews.setAppearance(event.sender, id, decodedAppearance),
      )
    }),
  )

  typedHandle('browser-preview:set-audio-muted', (event, previewId: unknown, audioMuted: unknown) =>
    Effect.gen(function* () {
      const [id, decodedAudioMuted] = yield* decode(browserPreviewIdAndAudioMutedSchema, [
        previewId,
        audioMuted,
      ])
      return yield* Effect.sync(() =>
        browserPreviewViews.setAudioMuted(event.sender, id, decodedAudioMuted),
      )
    }),
  )

  typedHandle(
    'browser-preview:replace-for-capacity',
    (event, input: unknown, replacedPreviewId: unknown) =>
      Effect.gen(function* () {
        const [decodedInput, decodedReplacedPreviewId] = yield* decode(
          browserPreviewReplacementInputSchema,
          [input, replacedPreviewId],
        )
        yield* requireBrowserEngineEffect
        return yield* Effect.sync(() =>
          browserPreviewViews.replaceForCapacity(
            event.sender,
            decodedInput,
            decodedReplacedPreviewId,
          ),
        )
      }),
  )

  typedHandle('browser-preview:open-devtools', (event, previewId: unknown) =>
    Effect.gen(function* () {
      const id = yield* decode(browserPreviewIdSchema, previewId)
      yield* Effect.tryPromise(() => browserPreviewViews.openDevTools(event.sender, id))
    }),
  )

  typedHandle('browser-preview:clear-cookies', (event, previewId: unknown) =>
    Effect.gen(function* () {
      const id = yield* decode(browserPreviewIdSchema, previewId)
      yield* Effect.tryPromise(() => browserPreviewViews.clearCookies(event.sender, id))
    }),
  )

  typedHandle('browser-preview:clear-cache', (event, previewId: unknown) =>
    Effect.gen(function* () {
      const id = yield* decode(browserPreviewIdSchema, previewId)
      yield* Effect.tryPromise(() => browserPreviewViews.clearCache(event.sender, id))
    }),
  )
}

function registerBrowserPreviewCaptureControlHandlers() {
  typedHandle('browser-preview:capture-screenshot', (event, previewId: unknown) =>
    Effect.gen(function* () {
      const id = yield* decode(browserPreviewIdSchema, previewId)
      return yield* Effect.tryPromise(() => browserPreviewViews.captureScreenshot(event.sender, id))
    }),
  )

  typedHandle('browser-preview:reveal-artifact', (event, artifactPath: unknown) =>
    Effect.gen(function* () {
      const decodedPath = yield* decode(browserPreviewArtifactPathSchema, artifactPath)
      yield* Effect.tryPromise(() => browserPreviewViews.revealArtifact(event.sender, decodedPath))
    }),
  )

  typedHandle('browser-preview:copy-screenshot', (event, artifactPath: unknown) =>
    Effect.gen(function* () {
      const decodedPath = yield* decode(browserPreviewArtifactPathSchema, artifactPath)
      yield* Effect.tryPromise(() => browserPreviewViews.copyScreenshot(event.sender, decodedPath))
    }),
  )

  typedHandle('browser-preview:start-recording', (event, previewId: unknown) =>
    Effect.gen(function* () {
      const id = yield* decode(browserPreviewIdSchema, previewId)
      return yield* Effect.tryPromise(() => browserPreviewViews.startRecording(event.sender, id))
    }),
  )

  typedHandle('browser-preview:save-recording', (event, input: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* decode(browserPreviewRecordingInputSchema, input)
      return yield* Effect.tryPromise(() =>
        browserPreviewViews.saveRecording(event.sender, decoded),
      )
    }),
  )

  typedHandle('browser-preview:stop-recording', (event, previewId: unknown) =>
    Effect.gen(function* () {
      const id = yield* decode(browserPreviewIdSchema, previewId)
      yield* Effect.sync(() => browserPreviewViews.stopRecording(event.sender, id))
    }),
  )

  typedHandle('browser-preview:pick-element', (event, previewId: unknown) =>
    Effect.gen(function* () {
      const id = yield* decode(browserPreviewIdSchema, previewId)
      return yield* Effect.tryPromise(() => browserPreviewViews.pickElement(event.sender, id))
    }),
  )

  typedHandle('browser-preview:cancel-pick-element', (event, previewId: unknown) =>
    Effect.gen(function* () {
      const id = yield* decode(browserPreviewIdSchema, previewId)
      yield* Effect.tryPromise(() => browserPreviewViews.cancelPickElement(event.sender, id))
    }),
  )

  typedHandle('browser-preview:open-picture-in-picture', (event, previewId: unknown) =>
    Effect.gen(function* () {
      const id = yield* decode(browserPreviewIdSchema, previewId)
      return yield* Effect.tryPromise(() =>
        browserPreviewViews.openPictureInPicture(event.sender, id),
      )
    }),
  )

  typedHandle('browser-preview:close-picture-in-picture', (event, previewId: unknown) =>
    Effect.gen(function* () {
      const id = yield* decode(browserPreviewIdSchema, previewId)
      return yield* Effect.sync(() => browserPreviewViews.closePictureInPicture(event.sender, id))
    }),
  )
}

export function registerBrowserPreviewControlHandlers() {
  registerBrowserPreviewDisplayControlHandlers()
  registerBrowserPreviewCaptureControlHandlers()
}
