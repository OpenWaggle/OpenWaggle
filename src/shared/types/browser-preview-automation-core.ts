import type {
  BrowserPreviewAppearance,
  BrowserPreviewViewport,
  BrowserPreviewViewportPresetId,
} from './browser-preview-controls'

export const BROWSER_PREVIEW_AUTOMATION_LIMITS = {
  DEFAULT_TIMEOUT_MS: 15_000,
  MAX_TIMEOUT_MS: 60_000,
  EXPRESSION_LENGTH: 64_000,
  RESULT_BYTES: 64 * 1_024,
  VISIBLE_TEXT_LENGTH: 48_000,
  INTERACTIVE_ELEMENTS: 512,
  CONSOLE_ENTRIES: 256,
  NETWORK_ENTRIES: 256,
  ACTION_EVENTS: 256,
} as const

export interface BrowserPreviewAutomationTarget {
  readonly tabId?: string
}

export interface BrowserPreviewAutomationStatus {
  readonly available: boolean
  readonly visible: boolean
  readonly tabId: string | null
  readonly url: string | null
  readonly title: string | null
  readonly loading: boolean
  readonly viewport: BrowserPreviewViewport | null
  readonly appearance: BrowserPreviewAppearance | null
}

export interface BrowserPreviewAutomationOpenInput extends BrowserPreviewAutomationTarget {
  readonly url?: string
  readonly open?: boolean
  readonly reuseExistingTab?: boolean
}

export type BrowserPreviewAutomationNavigationTarget =
  | { readonly kind: 'url'; readonly url: string }
  | {
      readonly kind: 'environment-port'
      readonly port: number
      readonly protocol?: 'http' | 'https'
      readonly path?: string
    }

export interface BrowserPreviewAutomationNavigateInput extends BrowserPreviewAutomationTarget {
  readonly url?: string
  readonly target?: BrowserPreviewAutomationNavigationTarget
  readonly readiness?: 'load' | 'domContentLoaded' | 'none'
  readonly timeoutMs?: number
}

export type BrowserPreviewAutomationResizeInput = BrowserPreviewAutomationTarget &
  (
    | { readonly mode: 'fill' }
    | { readonly mode: 'freeform'; readonly width: number; readonly height: number }
    | {
        readonly mode: 'preset'
        readonly preset: BrowserPreviewViewportPresetId
        readonly orientation?: 'portrait' | 'landscape'
      }
  )

export interface BrowserPreviewAutomationResizeResult {
  readonly tabId: string
  readonly viewport: BrowserPreviewViewport
}

export interface BrowserPreviewAutomationAppearanceInput extends BrowserPreviewAutomationTarget {
  readonly colorScheme: BrowserPreviewAppearance
}

export interface BrowserPreviewAutomationAppearanceResult {
  readonly tabId: string
  readonly colorScheme: BrowserPreviewAppearance
}
