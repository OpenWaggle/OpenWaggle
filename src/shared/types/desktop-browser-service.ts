import type { SessionId } from './brand'
import type {
  BrowserPreviewAutomationAppearanceInput,
  BrowserPreviewAutomationAppearanceResult,
  BrowserPreviewAutomationClickInput,
  BrowserPreviewAutomationEvaluateInput,
  BrowserPreviewAutomationNavigateInput,
  BrowserPreviewAutomationOpenInput,
  BrowserPreviewAutomationPressInput,
  BrowserPreviewAutomationRecordingArtifact,
  BrowserPreviewAutomationRecordingStatus,
  BrowserPreviewAutomationResizeInput,
  BrowserPreviewAutomationResizeResult,
  BrowserPreviewAutomationScrollInput,
  BrowserPreviewAutomationSnapshot,
  BrowserPreviewAutomationStatus,
  BrowserPreviewAutomationTarget,
  BrowserPreviewAutomationTypeInput,
  BrowserPreviewAutomationWaitInput,
} from './browser-preview-automation'
import type { JsonValue } from './json'

/** The Host supplies this scope; it is never taken from an agent tool's arguments. */
export interface DesktopBrowserScope {
  readonly sessionId: SessionId
  readonly workingPath: string
}

export interface DesktopBrowserInputMap {
  readonly status: BrowserPreviewAutomationTarget
  readonly open: BrowserPreviewAutomationOpenInput
  readonly navigate: BrowserPreviewAutomationNavigateInput
  readonly resize: BrowserPreviewAutomationResizeInput
  readonly setAppearance: BrowserPreviewAutomationAppearanceInput
  readonly snapshot: BrowserPreviewAutomationTarget
  readonly click: BrowserPreviewAutomationClickInput
  readonly type: BrowserPreviewAutomationTypeInput
  readonly press: BrowserPreviewAutomationPressInput
  readonly scroll: BrowserPreviewAutomationScrollInput
  readonly evaluate: BrowserPreviewAutomationEvaluateInput
  readonly waitFor: BrowserPreviewAutomationWaitInput
  readonly startRecording: BrowserPreviewAutomationTarget
  readonly stopRecording: BrowserPreviewAutomationTarget
}

export type DesktopBrowserSnapshot = Omit<BrowserPreviewAutomationSnapshot, 'accessibilityTree'> & {
  readonly accessibilityTree: JsonValue
}

export interface DesktopBrowserValueMap {
  readonly status: BrowserPreviewAutomationStatus
  readonly open: BrowserPreviewAutomationStatus
  readonly navigate: BrowserPreviewAutomationStatus
  readonly resize: BrowserPreviewAutomationResizeResult
  readonly setAppearance: BrowserPreviewAutomationAppearanceResult
  readonly snapshot: DesktopBrowserSnapshot
  readonly click: null
  readonly type: null
  readonly press: null
  readonly scroll: null
  /** Chromium's existing evaluation adapter represents absent values as null. */
  readonly evaluate: JsonValue
  readonly waitFor: null
  readonly startRecording: BrowserPreviewAutomationRecordingStatus
  readonly stopRecording: BrowserPreviewAutomationRecordingArtifact
}

export type DesktopBrowserOperation = keyof DesktopBrowserInputMap

export type DesktopBrowserCommand = {
  readonly [Operation in DesktopBrowserOperation]: {
    readonly service: 'browser'
    readonly operation: Operation
    readonly scope: DesktopBrowserScope
    readonly input: DesktopBrowserInputMap[Operation]
  }
}[DesktopBrowserOperation]

export type DesktopBrowserResult = {
  readonly [Operation in DesktopBrowserOperation]: {
    readonly service: 'browser'
    readonly operation: Operation
    readonly value: DesktopBrowserValueMap[Operation]
  }
}[DesktopBrowserOperation]
