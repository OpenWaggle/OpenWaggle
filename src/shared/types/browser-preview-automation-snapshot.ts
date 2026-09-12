export interface BrowserPreviewAutomationElement {
  readonly tag: string
  readonly role: string | null
  readonly name: string
  readonly selector: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface BrowserPreviewAutomationConsoleEntry {
  readonly level: string
  readonly text: string
  readonly timestamp: string
  readonly source?: string
}

export interface BrowserPreviewAutomationNetworkEntry {
  readonly url: string
  readonly method: string
  readonly status: number | null
  readonly failed: boolean
  readonly errorText?: string
  readonly timestamp: string
}

export interface BrowserPreviewAutomationActionEvent {
  readonly id: string
  readonly action: string
  readonly status: 'running' | 'succeeded' | 'failed' | 'interrupted'
  readonly startedAt: string
  readonly completedAt?: string
  readonly error?: string
}

export interface BrowserPreviewAutomationScreenshot {
  readonly mimeType: 'image/png'
  readonly data: string
  readonly width: number
  readonly height: number
}

export interface BrowserPreviewAutomationSnapshot {
  readonly url: string
  readonly title: string
  readonly loading: boolean
  readonly visibleText: string
  readonly interactiveElements: readonly BrowserPreviewAutomationElement[]
  readonly accessibilityTree: unknown
  readonly consoleEntries: readonly BrowserPreviewAutomationConsoleEntry[]
  readonly networkEntries: readonly BrowserPreviewAutomationNetworkEntry[]
  readonly actionTimeline: readonly BrowserPreviewAutomationActionEvent[]
  readonly screenshot: BrowserPreviewAutomationScreenshot
}

export interface BrowserPreviewAutomationRecordingStatus {
  readonly tabId: string
  readonly recording: boolean
  readonly startedAt: string | null
}

export interface BrowserPreviewAutomationRecordingArtifact {
  readonly id: string
  readonly tabId: string
  readonly path: string
  readonly mimeType: string
  readonly sizeBytes: number
  readonly createdAt: string
}
