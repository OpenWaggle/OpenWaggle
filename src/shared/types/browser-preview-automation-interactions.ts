import type { BrowserPreviewAutomationTarget } from './browser-preview-automation-core'

export interface BrowserPreviewAutomationClickInput extends BrowserPreviewAutomationTarget {
  readonly selector?: string | undefined
  readonly locator?: string | undefined
  readonly x?: number | undefined
  readonly y?: number | undefined
  readonly timeoutMs?: number | undefined
}

export interface BrowserPreviewAutomationTypeInput extends BrowserPreviewAutomationTarget {
  readonly text: string
  readonly selector?: string | undefined
  readonly locator?: string | undefined
  readonly clear?: boolean | undefined
  readonly timeoutMs?: number | undefined
}

export type BrowserPreviewAutomationModifier = 'Alt' | 'Control' | 'Meta' | 'Shift'

export interface BrowserPreviewAutomationPressInput extends BrowserPreviewAutomationTarget {
  readonly key: string
  readonly modifiers?: readonly BrowserPreviewAutomationModifier[] | undefined
}

export interface BrowserPreviewAutomationScrollInput extends BrowserPreviewAutomationTarget {
  readonly deltaX?: number | undefined
  readonly deltaY?: number | undefined
  readonly selector?: string | undefined
  readonly locator?: string | undefined
}

export interface BrowserPreviewAutomationEvaluateInput extends BrowserPreviewAutomationTarget {
  readonly expression: string
  readonly awaitPromise?: boolean | undefined
  readonly returnByValue?: boolean | undefined
}

export interface BrowserPreviewAutomationWaitInput extends BrowserPreviewAutomationTarget {
  readonly selector?: string | undefined
  readonly locator?: string | undefined
  readonly text?: string | undefined
  readonly urlIncludes?: string | undefined
  readonly timeoutMs?: number | undefined
}
