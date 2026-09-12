import type {
  BrowserImportInput,
  BrowserImportResult,
  BrowserImportSource,
  GuidedBrowserImportInput,
  GuidedBrowserImportResult,
} from './browser-import'
import type {
  BrowserPreviewBounds,
  BrowserPreviewOpenInput,
  BrowserPreviewReplacementResult,
  BrowserPreviewShortcutBindings,
  BrowserPreviewState,
  BrowserPreviewZoomAction,
} from './browser-preview'
import type {
  BrowserPreviewAnnotation,
  BrowserPreviewAppearance,
  BrowserPreviewRecordingArtifact,
  BrowserPreviewRecordingGrant,
  BrowserPreviewRecordingSaveInput,
  BrowserPreviewScreenshotArtifact,
  BrowserPreviewViewport,
} from './browser-preview-controls'
import type { BrowserPreviewOpenRequestAck } from './browser-preview-owner'
import type { BrowserPreviewRecordingRequestResponse } from './browser-preview-recording-request'

export interface IpcBrowserPreviewInvokeChannelMap {
  'browser-preview:open': {
    args: [input: BrowserPreviewOpenInput]
    return: BrowserPreviewState
  }
  'browser-preview:set-bounds': {
    args: [previewId: string, bounds: BrowserPreviewBounds | null]
    return: undefined
  }
  'browser-preview:navigate': {
    args: [previewId: string, url: string]
    return: BrowserPreviewState
  }
  'browser-preview:go-back': {
    args: [previewId: string]
    return: BrowserPreviewState
  }
  'browser-preview:go-forward': {
    args: [previewId: string]
    return: BrowserPreviewState
  }
  'browser-preview:reload': {
    args: [previewId: string]
    return: BrowserPreviewState
  }
  'browser-preview:stop': {
    args: [previewId: string]
    return: BrowserPreviewState
  }
  'browser-preview:close': {
    args: [previewId: string]
    return: undefined
  }
  'browser-preview:replace-for-capacity': {
    args: [input: BrowserPreviewOpenInput, replacedPreviewId: string]
    return: BrowserPreviewReplacementResult
  }
  'browser-preview:zoom': {
    args: [previewId: string, action: BrowserPreviewZoomAction]
    return: number
  }
  'browser-preview:set-viewport': {
    args: [previewId: string, viewport: BrowserPreviewViewport]
    return: BrowserPreviewState
  }
  'browser-preview:hard-reload': {
    args: [previewId: string]
    return: BrowserPreviewState
  }
  'browser-preview:set-appearance': {
    args: [previewId: string, appearance: BrowserPreviewAppearance]
    return: BrowserPreviewState
  }
  'browser-preview:set-audio-muted': {
    args: [previewId: string, audioMuted: boolean]
    return: BrowserPreviewState
  }
  'browser-preview:open-devtools': {
    args: [previewId: string]
    return: undefined
  }
  'browser-preview:clear-cookies': {
    args: [previewId: string]
    return: undefined
  }
  'browser-preview:clear-cache': {
    args: [previewId: string]
    return: undefined
  }
  'browser-preview:capture-screenshot': {
    args: [previewId: string]
    return: BrowserPreviewScreenshotArtifact
  }
  'browser-preview:reveal-artifact': {
    args: [artifactPath: string]
    return: undefined
  }
  'browser-preview:copy-screenshot': {
    args: [artifactPath: string]
    return: undefined
  }
  'browser-preview:start-recording': {
    args: [previewId: string]
    return: BrowserPreviewRecordingGrant
  }
  'browser-preview:save-recording': {
    args: [input: BrowserPreviewRecordingSaveInput]
    return: BrowserPreviewRecordingArtifact
  }
  'browser-preview:stop-recording': {
    args: [previewId: string]
    return: undefined
  }
  'browser-preview:pick-element': {
    args: [previewId: string]
    return: BrowserPreviewAnnotation | null
  }
  'browser-preview:cancel-pick-element': {
    args: [previewId: string]
    return: undefined
  }
  'browser-preview:open-picture-in-picture': {
    args: [previewId: string]
    return: BrowserPreviewState
  }
  'browser-preview:close-picture-in-picture': {
    args: [previewId: string]
    return: BrowserPreviewState
  }
  'browser-preview:register-owner': {
    args: [ownerKey: string]
    return: undefined
  }
  'browser-preview:unregister-owner': {
    args: [ownerKey: string]
    return: undefined
  }
  'browser-preview:ack-open-request': {
    args: [acknowledgment: BrowserPreviewOpenRequestAck]
    return: undefined
  }
  'browser-preview:set-current': {
    args: [ownerKey: string, previewId: string | null]
    return: undefined
  }
  'browser-preview:respond-recording-request': {
    args: [response: BrowserPreviewRecordingRequestResponse]
    return: undefined
  }
  'browser-preview:set-shortcut-bindings': {
    args: [bindings: BrowserPreviewShortcutBindings]
    return: undefined
  }
  'browser-preview:list-import-sources': {
    args: []
    return: readonly BrowserImportSource[]
  }
  'browser-preview:import-cookies': {
    args: [input: BrowserImportInput]
    return: BrowserImportResult
  }
  'browser-preview:guided-import-cookies': {
    args: [input: GuidedBrowserImportInput]
    return: GuidedBrowserImportResult
  }
  'browser-preview:open-full-disk-access-settings': {
    args: []
    return: boolean
  }
  'browser-preview:clear-profile-data': {
    args: [profileId: string]
    return: undefined
  }
}
