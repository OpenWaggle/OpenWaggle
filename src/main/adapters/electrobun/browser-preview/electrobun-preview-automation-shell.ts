import { ABORTED_LOAD_ERROR_TEXT } from '../../browser-preview/browser-preview-page-state'
import type {
  BrowserPreviewAutomationNavigation,
  BrowserPreviewAutomationShell,
} from '../../browser-preview/automation/browser-preview-automation-service'
import { sendBrowserPreviewOwnerEvent } from '../../browser-preview/browser-preview-owner-events'
import { cefAutomationContents } from './electrobun-preview-automation-contents'
import { decode, NavigateResultSchema } from './electrobun-preview-cdp-protocol'
import {
  type ElectrobunPreviewRecord,
  ELECTROBUN_PREVIEW_UNSUPPORTED,
} from './electrobun-preview-records'

const READINESS_EVENT = {
  load: 'Page.loadEventFired',
  domContentLoaded: 'Page.domContentEventFired',
  none: null,
} as const

function abortError(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('Browser preview navigation was cancelled.')
}

/** Resolves on `method`, or rejects on the deadline or the abort. */
function cdpEventWithin(
  record: ElectrobunPreviewRecord,
  method: string,
  { timeoutMs, signal }: Pick<BrowserPreviewAutomationNavigation, 'timeoutMs' | 'signal'>,
) {
  const cleanups: (() => void)[] = []
  const reached = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () =>
        reject(
          new Error(`Browser preview navigation did not finish within ${String(timeoutMs)} ms.`),
        ),
      timeoutMs,
    )
    const onAbort = () => reject(abortError(signal))
    const unsubscribe = record.guest.onCdpEvent((event) => {
      if (event === method) resolve()
    })
    signal.addEventListener('abort', onAbort, { once: true })
    cleanups.push(
      () => clearTimeout(timeout),
      unsubscribe,
      () => signal.removeEventListener('abort', onAbort),
    )
  })
  const cleanup = () => {
    for (const release of cleanups.splice(0)) release()
  }
  return { reached, cleanup }
}

/**
 * Navigates a CEF preview over CDP and waits for the readiness the agent asked for. A same-document
 * navigation (a fragment) loads no document, so `Page.navigate` returns no loader and it is done.
 */
async function navigateCefPreviewAndWait(
  manager: ElectrobunAutomationOperations,
  record: ElectrobunPreviewRecord,
  navigation: BrowserPreviewAutomationNavigation,
) {
  if (navigation.signal.aborted) throw abortError(navigation.signal)
  const url = manager.beginNavigation(record, navigation.url)
  const readinessEvent = READINESS_EVENT[navigation.readiness]
  const wait = readinessEvent === null ? null : cdpEventWithin(record, readinessEvent, navigation)
  try {
    const result = decode(NavigateResultSchema, await record.guest.send('Page.navigate', { url }))
    if (result?.errorText !== undefined && result.errorText !== ABORTED_LOAD_ERROR_TEXT) {
      throw new Error(`Browser preview navigation failed: ${result.errorText}`)
    }
    if (wait !== null && result?.loaderId !== undefined) await wait.reached
  } catch (error) {
    manager.fail(record, error)
    throw error
  } finally {
    wait?.cleanup()
  }
}

type Shell = BrowserPreviewAutomationShell<ElectrobunPreviewRecord>

/** The preview manager's operations the agent's tools reach. */
export interface ElectrobunAutomationOperations extends Pick<
  Shell,
  'findTab' | 'selectTab' | 'requestOpen' | 'setViewport' | 'setAppearance'
> {
  /** Shows `url` loading in the preview's state; returns the canonical URL to navigate to. */
  readonly beginNavigation: (record: ElectrobunPreviewRecord, url: string) => string
  readonly fail: (record: ElectrobunPreviewRecord, error: unknown) => void
}

/** Electrobun's CEF previews as the agent's Browser preview tools see them. */
export function electrobunAutomationShell(manager: ElectrobunAutomationOperations): Shell {
  return {
    findTab: manager.findTab,
    selectTab: manager.selectTab,
    page: (record) => ({
      tabId: `${String(record.owner.sender.id)}:${record.previewId}`,
      contents: cefAutomationContents(record),
      onControllerChange: (controller) => {
        if (record.disposed) return
        record.state = { ...record.state, controller }
        sendBrowserPreviewOwnerEvent(record, {
          channel: 'browser-preview:state',
          payload: record.state,
        })
      },
    }),
    requestOpen: manager.requestOpen,
    navigateAndWait: (record, navigation) => navigateCefPreviewAndWait(manager, record, navigation),
    setViewport: manager.setViewport,
    setAppearance: manager.setAppearance,
    startRecording: () => Promise.reject(new Error(ELECTROBUN_PREVIEW_UNSUPPORTED.recording)),
    stopRecording: () => Promise.reject(new Error(ELECTROBUN_PREVIEW_UNSUPPORTED.recording)),
  }
}
