export interface BrowserPreviewOpenRequestInput {
  readonly ownerKey: string
  readonly previewId: string
  readonly profileId: string
  readonly url: string
  /** Whether the workspace panel should be visible after the tab is materialized. */
  readonly visible: boolean
  /** Whether this tab should become the selected browser surface. */
  readonly activate: boolean
}

export interface BrowserPreviewOpenRequest extends BrowserPreviewOpenRequestInput {
  readonly requestId: string
  readonly generation: number
}

export interface BrowserPreviewOpenRequestAck {
  readonly requestId: string
  readonly generation: number
  readonly ownerKey: string
  readonly previewId: string
  readonly success: boolean
  readonly error?: string
}

export interface BrowserPreviewOpenRequestCancellation {
  readonly requestId: string
  readonly generation: number
  readonly ownerKey: string
  readonly previewId: string
}
