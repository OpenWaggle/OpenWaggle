import type { Event, RenderProcessGoneDetails } from 'electron'
import {
  BrowserPreviewCrashRecovery,
  isRecoverableBrowserPreviewCrash,
} from './browser-preview-crash-recovery'
import { browserPreviewStateError } from './browser-preview-policy'
import type { BrowserPreviewEventActions, BrowserPreviewRecord } from './browser-preview-records'

export function monitorBrowserPreviewCrashRecovery(
  record: BrowserPreviewRecord,
  actions: BrowserPreviewEventActions,
) {
  const contents = record.view.webContents
  let lastCrashReason = 'unknown'
  const recovery = new BrowserPreviewCrashRecovery({
    isCurrent: () => !record.disposed && !contents.isDestroyed(),
    recover: () => actions.reload(),
    onExhausted: () => {
      record.state = {
        ...record.state,
        loading: false,
        error: browserPreviewStateError(
          'RENDERER_GONE',
          `Preview process exited: ${lastCrashReason}. Automatic recovery stopped after three attempts.`,
          record.state.url,
        ),
      }
      actions.emitState()
    },
  })
  const onViewGone = (_event: Event, details: RenderProcessGoneDetails) => {
    lastCrashReason = details.reason
    record.state = {
      ...record.state,
      loading: false,
      error: browserPreviewStateError(
        'RENDERER_GONE',
        `Preview process exited: ${details.reason}.`,
        record.state.url,
      ),
    }
    actions.emitState()
    if (isRecoverableBrowserPreviewCrash(details.reason)) {
      recovery.start()
      return
    }
    recovery.dispose()
    actions.dispose()
  }
  const onNavigationStarted = (
    _event: Event,
    _url: string,
    _isInPlace: boolean,
    isMainFrame: boolean,
  ) => {
    if (isMainFrame) recovery.navigationStarted()
  }

  contents.on('did-start-navigation', onNavigationStarted)
  contents.on('render-process-gone', onViewGone)
  return [
    () => recovery.dispose(),
    () => contents.removeListener('did-start-navigation', onNavigationStarted),
    () => contents.removeListener('render-process-gone', onViewGone),
  ]
}
