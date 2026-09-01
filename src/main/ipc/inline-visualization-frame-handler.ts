import fs from 'node:fs/promises'
import { safeDecodeUnknown } from '@shared/schema'
import {
  inlineVisualizationDownloadInputSchema,
  inlineVisualizationFrameRegisterInputSchema,
  inlineVisualizationFrameUnregisterInputSchema,
} from '@shared/schemas/inline-visualization'
import * as Effect from 'effect/Effect'
import type { Event, WebContents, WebContentsDidStartNavigationEventParams } from 'electron'
import { decodeInlineVisualizationDownload } from '../application/inline-visualization-download'
import { browserWindowFromWebContents, showSaveDialog } from '../desktop-ui'
import { shouldPurgeVisualizationFramesForNavigation } from '../inline-visualization-owner-lifecycle'
import {
  registerInlineVisualizationFrame,
  unregisterInlineVisualizationFrame,
  unregisterInlineVisualizationFramesForOwner,
} from '../inline-visualization-protocol'
import { typedHandle } from './typed-ipc'

const monitoredRendererOwners = new Map<number, WebContents>()

function monitorRendererOwner(sender: WebContents) {
  if (monitoredRendererOwners.has(sender.id)) return
  monitoredRendererOwners.set(sender.id, sender)
  const purge = () => unregisterInlineVisualizationFramesForOwner(sender.id)
  const onNavigation = (details: Event<WebContentsDidStartNavigationEventParams>) => {
    if (shouldPurgeVisualizationFramesForNavigation(details)) purge()
  }
  const stopMonitoring = () => {
    sender.removeListener('did-start-navigation', onNavigation)
    sender.removeListener('render-process-gone', onRenderProcessGone)
    sender.removeListener('destroyed', onDestroyed)
    monitoredRendererOwners.delete(sender.id)
  }
  const onRenderProcessGone = () => {
    purge()
    stopMonitoring()
  }
  const onDestroyed = () => {
    purge()
    stopMonitoring()
  }
  sender.on('did-start-navigation', onNavigation)
  sender.once('render-process-gone', onRenderProcessGone)
  sender.once('destroyed', onDestroyed)
}

function decodeDownload(value: unknown) {
  const decoded = safeDecodeUnknown(inlineVisualizationDownloadInputSchema, value)
  if (!decoded.success) throw new Error(decoded.issues.join('; '))
  return decodeInlineVisualizationDownload(decoded.data)
}

export function registerInlineVisualizationFrameHandlers() {
  typedHandle('visualizations:register-frame', (event, input: unknown) =>
    Effect.gen(function* () {
      const decoded = safeDecodeUnknown(inlineVisualizationFrameRegisterInputSchema, input)
      if (!decoded.success) return yield* Effect.fail(new Error(decoded.issues.join('; ')))
      monitorRendererOwner(event.sender)
      return registerInlineVisualizationFrame(decoded.data, event.sender.id)
    }),
  )
  typedHandle('visualizations:unregister-frame', (event, input: unknown) =>
    Effect.gen(function* () {
      const decoded = safeDecodeUnknown(inlineVisualizationFrameUnregisterInputSchema, input)
      if (!decoded.success) return yield* Effect.fail(new Error(decoded.issues.join('; ')))
      unregisterInlineVisualizationFrame(decoded.data, event.sender.id)
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
