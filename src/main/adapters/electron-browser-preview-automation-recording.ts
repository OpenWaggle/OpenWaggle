import type { BrowserPreviewAutomationRecordingArtifact } from '@shared/types/browser-preview-automation'
import { browserPreviewRecordingRequestBroker } from '../browser-preview-recording-request-broker'
import type { BrowserPreviewAutomationServiceShape } from '../ports/browser-preview-automation-service'
import {
  type BrowserPreviewAutomationAccessGuard,
  browserPreviewAutomationPromiseEffect,
} from './electron-browser-preview-automation-effects'
import { requireBrowserPreviewAutomationRecord } from './electron-browser-preview-automation-records'

type BrowserPreviewAutomationRecordingOperations = Pick<
  BrowserPreviewAutomationServiceShape,
  'startRecording' | 'stopRecording'
>

function mapRecordingArtifact(
  tabId: string,
  artifact: Awaited<ReturnType<typeof browserPreviewRecordingRequestBroker.stop>>,
): BrowserPreviewAutomationRecordingArtifact {
  return {
    id: artifact.id,
    tabId,
    path: artifact.path,
    mimeType: artifact.mimeType,
    sizeBytes: artifact.sizeBytes,
    createdAt: artifact.createdAt,
  }
}

export function makeBrowserPreviewAutomationRecordingOperations(
  withAgentAccess: BrowserPreviewAutomationAccessGuard,
): BrowserPreviewAutomationRecordingOperations {
  return {
    startRecording: (scope, input) =>
      withAgentAccess(
        browserPreviewAutomationPromiseEffect(async (signal) => {
          const record = requireBrowserPreviewAutomationRecord(scope, input)
          await browserPreviewRecordingRequestBroker.start(record, { signal })
          const startedAt = new Date().toISOString()
          return { tabId: record.previewId, recording: true, startedAt }
        }),
      ),
    stopRecording: (scope, input) =>
      withAgentAccess(
        browserPreviewAutomationPromiseEffect(async (signal) => {
          const record = requireBrowserPreviewAutomationRecord(scope, input)
          const artifact = await browserPreviewRecordingRequestBroker.stop(record, { signal })
          return mapRecordingArtifact(record.previewId, artifact)
        }),
      ),
  }
}
