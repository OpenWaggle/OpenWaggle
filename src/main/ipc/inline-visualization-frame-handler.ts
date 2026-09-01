import fs from 'node:fs/promises'
import { safeDecodeUnknown } from '@shared/schema'
import {
  inlineVisualizationDownloadInputSchema,
  inlineVisualizationFrameRegisterInputSchema,
  inlineVisualizationFrameTerminateInputSchema,
  inlineVisualizationFrameUnregisterInputSchema,
} from '@shared/schemas/inline-visualization'
import * as Effect from 'effect/Effect'
import { decodeInlineVisualizationDownload } from '../application/inline-visualization-download'
import { browserWindowFromWebContents, showSaveDialog } from '../desktop-ui'
import { terminateInlineVisualizationFrameProcess } from '../inline-visualization-process-termination'
import {
  isRegisteredInlineVisualizationFrame,
  registerInlineVisualizationFrame,
  unregisterInlineVisualizationFrame,
} from '../inline-visualization-protocol'
import { typedHandle } from './typed-ipc'

function decodeDownload(value: unknown) {
  const decoded = safeDecodeUnknown(inlineVisualizationDownloadInputSchema, value)
  if (!decoded.success) throw new Error(decoded.issues.join('; '))
  return decodeInlineVisualizationDownload(decoded.data)
}

export function registerInlineVisualizationFrameHandlers() {
  typedHandle('visualizations:register-frame', (_event, input: unknown) =>
    Effect.gen(function* () {
      const decoded = safeDecodeUnknown(inlineVisualizationFrameRegisterInputSchema, input)
      if (!decoded.success) return yield* Effect.fail(new Error(decoded.issues.join('; ')))
      return registerInlineVisualizationFrame(decoded.data)
    }),
  )
  typedHandle('visualizations:unregister-frame', (_event, input: unknown) =>
    Effect.gen(function* () {
      const decoded = safeDecodeUnknown(inlineVisualizationFrameUnregisterInputSchema, input)
      if (!decoded.success) return yield* Effect.fail(new Error(decoded.issues.join('; ')))
      unregisterInlineVisualizationFrame(decoded.data)
    }),
  )
  typedHandle('visualizations:terminate-frame', (event, input: unknown) =>
    Effect.gen(function* () {
      const decoded = safeDecodeUnknown(inlineVisualizationFrameTerminateInputSchema, input)
      if (!decoded.success) return yield* Effect.fail(new Error(decoded.issues.join('; ')))
      return terminateInlineVisualizationFrameProcess({
        ...decoded.data,
        mainFrame: event.sender.mainFrame,
        framesInSubtree: event.sender.mainFrame.framesInSubtree,
        isRegistered: isRegisteredInlineVisualizationFrame,
      })
    }),
  )
  typedHandle('visualizations:save-download', (event, input: unknown) =>
    Effect.tryPromise({
      try: async () => {
        const download = decodeDownload(input)
        const result = await showSaveDialog(browserWindowFromWebContents(event.sender), {
          defaultPath: download.suggestedName,
          title: 'Save visualization download',
        })
        if (result.canceled || !result.filePath) return false
        await fs.writeFile(result.filePath, download.contents)
        return true
      },
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    }),
  )
}
