import type { WebContents } from 'electron'
import type { BrowserPreviewNavigationReadiness } from '../../browser-preview/automation/browser-preview-automation-service'

export type BrowserPreviewNavigationWebContents = Pick<
  WebContents,
  'getURL' | 'isDestroyed' | 'on' | 'removeListener' | 'stop'
>

export interface BrowserPreviewAutomationNavigationOperation {
  readonly generation: number
  readonly completion: Promise<void>
  readonly isCurrent: () => boolean
  readonly stop: () => void
}

export interface BrowserPreviewNavigationWaitInput {
  readonly contents: BrowserPreviewNavigationWebContents
  readonly url: string
  readonly readiness: BrowserPreviewNavigationReadiness
  readonly timeoutMs: number
  readonly signal?: AbortSignal
  readonly navigate: () => BrowserPreviewAutomationNavigationOperation
}

export { navigateBrowserPreviewAndWait } from './browser-preview-automation-navigation-wait'
