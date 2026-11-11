import {
  BindingCalledSchema,
  ContextCreatedSchema,
  ContextDestroyedSchema,
  decode,
  decodeJson,
  type ElectrobunPreviewGuestEvent,
  FrameIdSchema,
  FrameNavigatedSchema,
  PageMessageSchema,
  SameDocumentSchema,
} from './electrobun-preview-cdp-protocol'
import {
  BROWSER_PREVIEW_HOST_BINDING,
  BROWSER_PREVIEW_WORLD_NAME,
} from './electrobun-preview-page-script'
import { createLogger } from '../../../logger'

const logger = createLogger('electrobun-browser-preview')

/** What the CDP event handlers of one preview page read and report. */
export interface CdpPageEventSink {
  readonly marker: string
  readonly emit: (event: ElectrobunPreviewGuestEvent) => void
  readonly isMainFrame: (frameId: string) => boolean
  readonly setMainFrame: (frameId: string) => void
  readonly refreshHistory: () => void
  readonly dismissDialog: () => void
  /** The page script's isolated worlds, by execution context id. */
  readonly pageWorlds: Set<number>
}

function receivePageMessage(sink: CdpPageEventSink, params: unknown) {
  const call = decode(BindingCalledSchema, params)
  if (call?.name !== BROWSER_PREVIEW_HOST_BINDING) return
  const message = decodeJson(PageMessageSchema, call.payload)
  if (message === null) {
    logger.warn('Ignored a malformed browser preview page message', {
      bytes: call.payload.length,
    })
    return
  }
  if (message.kind === 'title') {
    sink.emit({ kind: 'title', title: message.title })
    return
  }
  const { kind: _kind, ...input } = message
  sink.emit({ kind: 'key', input })
}

function onMainFrame(sink: CdpPageEventSink, params: unknown, event: ElectrobunPreviewGuestEvent) {
  const frame = decode(FrameIdSchema, params)
  if (frame === null || !sink.isMainFrame(frame.frameId)) return
  sink.emit(event)
  if (event.kind === 'loaded') sink.refreshHistory()
}

/** The CDP events a preview page reacts to, by method. */
export function cdpPageEventHandlers(
  sink: CdpPageEventSink,
): ReadonlyMap<string, (params: unknown) => void> {
  return new Map<string, (params: unknown) => void>([
    ['Page.frameStartedLoading', (params) => onMainFrame(sink, params, { kind: 'loading' })],
    ['Page.frameStoppedLoading', (params) => onMainFrame(sink, params, { kind: 'loaded' })],
    [
      'Page.frameNavigated',
      (params) => {
        const navigated = decode(FrameNavigatedSchema, params)
        if (!navigated || navigated.frame.parentId !== undefined) return
        sink.setMainFrame(navigated.frame.id)
        const url = `${navigated.frame.url}${navigated.frame.urlFragment ?? ''}`
        if (!url.includes(sink.marker)) sink.emit({ kind: 'navigated', url })
        sink.refreshHistory()
      },
    ],
    [
      'Page.navigatedWithinDocument',
      (params) => {
        const navigated = decode(SameDocumentSchema, params)
        if (!navigated || !sink.isMainFrame(navigated.frameId)) return
        if (!navigated.url.includes(sink.marker)) {
          sink.emit({ kind: 'navigated', url: navigated.url })
        }
        sink.refreshHistory()
      },
    ],
    // Previews show no page dialogs, as Electron's `disableDialogs` does.
    ['Page.javascriptDialogOpening', () => sink.dismissDialog()],
    ['Inspector.targetCrashed', () => sink.emit({ kind: 'crashed' })],
    [
      'Runtime.executionContextCreated',
      (params) => {
        const created = decode(ContextCreatedSchema, params)
        if (created?.context.name === BROWSER_PREVIEW_WORLD_NAME) {
          sink.pageWorlds.add(created.context.id)
        }
      },
    ],
    [
      'Runtime.executionContextDestroyed',
      (params) => {
        const destroyed = decode(ContextDestroyedSchema, params)
        if (destroyed) sink.pageWorlds.delete(destroyed.executionContextId)
      },
    ],
    ['Runtime.executionContextsCleared', () => sink.pageWorlds.clear()],
    ['Runtime.bindingCalled', (params) => receivePageMessage(sink, params)],
  ])
}
