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
import { browserPreviewManager } from '../browser-preview'
import { browserPreviewRecordingRequestBroker } from '../browser-preview-recording-request-broker'
import { typedHandle } from './typed-ipc'

function decode<T, I>(schema: EffectSchema<T, I, never>, value: unknown) {
  const decoded = safeDecodeUnknown(schema, value)
  return decoded.success
    ? Effect.succeed(decoded.data)
    : Effect.fail(new Error(decoded.issues.join('; ')))
}

function registerBrowserPreviewDisplayControlHandlers() {
  typedHandle('browser-preview:respond-recording-request', (event, response: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* decode(browserPreviewRecordingRequestResponseSchema, response)
      yield* Effect.sync(() => browserPreviewRecordingRequestBroker.respond(event.sender, decoded))
    }),
  )

  typedHandle('browser-preview:set-viewport', (event, previewId: unknown, viewport: unknown) =>
    Effect.gen(function* () {
      const [id, decodedViewport] = yield* decode(browserPreviewIdAndViewportSchema, [
        previewId,
        viewport,
      ])
      return yield* Effect.sync(() =>
        browserPreviewManager.setViewport(event.sender, id, decodedViewport),
      )
    }),
  )

  typedHandle('browser-preview:hard-reload', (event, previewId: unknown) =>
    Effect.gen(function* () {
      const id = yield* decode(browserPreviewIdSchema, previewId)
      return yield* Effect.sync(() => browserPreviewManager.hardReload(event.sender, id))
    }),
  )

  typedHandle('browser-preview:set-appearance', (event, previewId: unknown, appearance: unknown) =>
    Effect.gen(function* () {
      const [id, decodedAppearance] = yield* decode(browserPreviewIdAndAppearanceSchema, [
        previewId,
        appearance,
      ])
      return yield* Effect.tryPromise(() =>
        browserPreviewManager.setAppearance(event.sender, id, decodedAppearance),
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
        browserPreviewManager.setAudioMuted(event.sender, id, decodedAudioMuted),
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
        return yield* Effect.sync(() =>
          browserPreviewManager.replaceForCapacity(
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
      yield* Effect.tryPromise(() => browserPreviewManager.openDevTools(event.sender, id))
    }),
  )

  typedHandle('browser-preview:clear-cookies', (event, previewId: unknown) =>
    Effect.gen(function* () {
      const id = yield* decode(browserPreviewIdSchema, previewId)
      yield* Effect.tryPromise(() => browserPreviewManager.clearCookies(event.sender, id))
    }),
  )

  typedHandle('browser-preview:clear-cache', (event, previewId: unknown) =>
    Effect.gen(function* () {
      const id = yield* decode(browserPreviewIdSchema, previewId)
      yield* Effect.tryPromise(() => browserPreviewManager.clearCache(event.sender, id))
    }),
  )
}

function registerBrowserPreviewCaptureControlHandlers() {
  typedHandle('browser-preview:capture-screenshot', (event, previewId: unknown) =>
    Effect.gen(function* () {
      const id = yield* decode(browserPreviewIdSchema, previewId)
      return yield* Effect.tryPromise(() =>
        browserPreviewManager.captureScreenshot(event.sender, id),
      )
    }),
  )

  typedHandle('browser-preview:reveal-artifact', (event, artifactPath: unknown) =>
    Effect.gen(function* () {
      const decodedPath = yield* decode(browserPreviewArtifactPathSchema, artifactPath)
      yield* Effect.tryPromise(() =>
        browserPreviewManager.revealArtifact(event.sender, decodedPath),
      )
    }),
  )

  typedHandle('browser-preview:copy-screenshot', (event, artifactPath: unknown) =>
    Effect.gen(function* () {
      const decodedPath = yield* decode(browserPreviewArtifactPathSchema, artifactPath)
      yield* Effect.tryPromise(() =>
        browserPreviewManager.copyScreenshot(event.sender, decodedPath),
      )
    }),
  )

  typedHandle('browser-preview:start-recording', (event, previewId: unknown) =>
    Effect.gen(function* () {
      const id = yield* decode(browserPreviewIdSchema, previewId)
      return yield* Effect.tryPromise(() => browserPreviewManager.startRecording(event.sender, id))
    }),
  )

  typedHandle('browser-preview:save-recording', (event, input: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* decode(browserPreviewRecordingInputSchema, input)
      return yield* Effect.tryPromise(() =>
        browserPreviewManager.saveRecording(event.sender, decoded),
      )
    }),
  )

  typedHandle('browser-preview:stop-recording', (event, previewId: unknown) =>
    Effect.gen(function* () {
      const id = yield* decode(browserPreviewIdSchema, previewId)
      yield* Effect.sync(() => browserPreviewManager.stopRecording(event.sender, id))
    }),
  )

  typedHandle('browser-preview:pick-element', (event, previewId: unknown) =>
    Effect.gen(function* () {
      const id = yield* decode(browserPreviewIdSchema, previewId)
      return yield* Effect.tryPromise(() => browserPreviewManager.pickElement(event.sender, id))
    }),
  )

  typedHandle('browser-preview:cancel-pick-element', (event, previewId: unknown) =>
    Effect.gen(function* () {
      const id = yield* decode(browserPreviewIdSchema, previewId)
      yield* Effect.tryPromise(() => browserPreviewManager.cancelPickElement(event.sender, id))
    }),
  )

  typedHandle('browser-preview:open-picture-in-picture', (event, previewId: unknown) =>
    Effect.gen(function* () {
      const id = yield* decode(browserPreviewIdSchema, previewId)
      return yield* Effect.tryPromise(() =>
        browserPreviewManager.openPictureInPicture(event.sender, id),
      )
    }),
  )

  typedHandle('browser-preview:close-picture-in-picture', (event, previewId: unknown) =>
    Effect.gen(function* () {
      const id = yield* decode(browserPreviewIdSchema, previewId)
      return yield* Effect.sync(() => browserPreviewManager.closePictureInPicture(event.sender, id))
    }),
  )
}

export function registerBrowserPreviewControlHandlers(): void {
  registerBrowserPreviewDisplayControlHandlers()
  registerBrowserPreviewCaptureControlHandlers()
}
