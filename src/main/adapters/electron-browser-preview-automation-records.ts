import type {
  BrowserPreviewAutomationStatus,
  BrowserPreviewAutomationTarget,
} from '@shared/types/browser-preview-automation'
import { browserPreviewManager } from '../browser-preview'
import type { BrowserPreviewRecord } from '../browser-preview-records'
import type { BrowserPreviewAutomationScope } from '../ports/browser-preview-automation-service'

export function browserPreviewAutomationOwnerKey(scope: BrowserPreviewAutomationScope) {
  return String(scope.sessionId)
}

export function findBrowserPreviewAutomationRecord(
  scope: BrowserPreviewAutomationScope,
  target: BrowserPreviewAutomationTarget,
): BrowserPreviewRecord | undefined {
  return browserPreviewManager.findOwnedPreview(
    browserPreviewAutomationOwnerKey(scope),
    target.tabId,
  )
}

export function requireBrowserPreviewAutomationRecord(
  scope: BrowserPreviewAutomationScope,
  target: BrowserPreviewAutomationTarget,
): BrowserPreviewRecord {
  const record = findBrowserPreviewAutomationRecord(scope, target)
  if (record) {
    if (target.tabId !== undefined) {
      browserPreviewManager.setCurrentPreview(
        record.owner.sender,
        browserPreviewAutomationOwnerKey(scope),
        record.previewId,
      )
    }
    return record
  }
  throw new Error(
    target.tabId
      ? `Browser preview "${target.tabId}" was not found for this session.`
      : 'This session does not have a current browser preview.',
  )
}

export function browserPreviewAutomationStatusFor(
  record?: BrowserPreviewRecord,
): BrowserPreviewAutomationStatus {
  if (!record || record.disposed) {
    return {
      available: false,
      visible: false,
      tabId: null,
      url: null,
      title: null,
      loading: false,
      viewport: null,
      appearance: null,
    }
  }
  return {
    available: true,
    visible: record.bounds !== null,
    tabId: record.previewId,
    url: record.state.url,
    title: record.state.title,
    loading: record.state.loading,
    viewport: record.state.controls.viewport,
    appearance: record.state.controls.appearance,
  }
}
