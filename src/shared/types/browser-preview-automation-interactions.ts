import type { BrowserPreviewAutomationTarget } from './browser-preview-automation-core'

export interface BrowserPreviewAutomationClickInput extends BrowserPreviewAutomationTarget {
  readonly selector?: string
  readonly locator?: string
  readonly x?: number
  readonly y?: number
  readonly timeoutMs?: number
}

export interface BrowserPreviewAutomationTypeInput extends BrowserPreviewAutomationTarget {
  readonly text: string
  readonly selector?: string
  readonly locator?: string
  readonly clear?: boolean
  readonly timeoutMs?: number
}

export type BrowserPreviewAutomationModifier = 'Alt' | 'Control' | 'Meta' | 'Shift'

export interface BrowserPreviewAutomationPressInput extends BrowserPreviewAutomationTarget {
  readonly key: string
  readonly modifiers?: readonly BrowserPreviewAutomationModifier[]
}

export interface BrowserPreviewAutomationScrollInput extends BrowserPreviewAutomationTarget {
  readonly deltaX?: number
  readonly deltaY?: number
  readonly selector?: string
  readonly locator?: string
}

export interface BrowserPreviewAutomationEvaluateInput extends BrowserPreviewAutomationTarget {
  readonly expression: string
  readonly awaitPromise?: boolean
  readonly returnByValue?: boolean
}

export interface BrowserPreviewAutomationWaitInput extends BrowserPreviewAutomationTarget {
  readonly selector?: string
  readonly locator?: string
  readonly text?: string
  readonly urlIncludes?: string
  readonly timeoutMs?: number
}
