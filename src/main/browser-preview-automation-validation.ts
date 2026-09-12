import { matchBy } from '@diegogbrisa/ts-match'
import {
  browserPreviewPresetViewport,
  isValidBrowserPreviewViewportSize,
} from '@shared/browser-preview-viewports'
import type {
  BrowserPreviewAutomationClickInput,
  BrowserPreviewAutomationNavigateInput,
  BrowserPreviewAutomationOpenInput,
  BrowserPreviewAutomationResizeInput,
  BrowserPreviewAutomationScrollInput,
  BrowserPreviewAutomationTypeInput,
  BrowserPreviewAutomationWaitInput,
} from '@shared/types/browser-preview-automation'
import { BROWSER_PREVIEW_AUTOMATION_LIMITS } from '@shared/types/browser-preview-automation'
import type { BrowserPreviewViewport } from '@shared/types/browser-preview-controls'
import { normalizeBrowserPreviewAddress } from '@shared/utils/browser-preview-url'

const MAX_TCP_PORT = 65_535

export function validateBrowserPreviewAutomationTimeout(timeoutMs?: number) {
  const value = timeoutMs ?? BROWSER_PREVIEW_AUTOMATION_LIMITS.DEFAULT_TIMEOUT_MS
  if (
    !Number.isInteger(value) ||
    value <= 0 ||
    value > BROWSER_PREVIEW_AUTOMATION_LIMITS.MAX_TIMEOUT_MS
  ) {
    throw new Error(
      `Browser preview timeout must be between 1 and ${String(BROWSER_PREVIEW_AUTOMATION_LIMITS.MAX_TIMEOUT_MS)} milliseconds.`,
    )
  }
  return value
}

function normalizeAddress(value: string) {
  const normalized = normalizeBrowserPreviewAddress(value)
  if (normalized === null) throw new Error('Browser preview URL must be a valid HTTP(S) address.')
  return normalized
}

export function validateBrowserPreviewAutomationOpen(input: BrowserPreviewAutomationOpenInput) {
  if (input.tabId !== undefined && input.reuseExistingTab === false) {
    throw new Error('tabId cannot be combined with reuseExistingTab=false.')
  }
  return input.url === undefined ? null : normalizeAddress(input.url)
}

function environmentPortUrl(
  target: Extract<
    NonNullable<BrowserPreviewAutomationNavigateInput['target']>,
    { kind: 'environment-port' }
  >,
) {
  if (!Number.isInteger(target.port) || target.port <= 0 || target.port > MAX_TCP_PORT) {
    throw new Error('Environment port must be between 1 and 65535.')
  }
  const path = target.path ?? '/'
  if (/^[a-z][a-z\d+.-]*:/iu.test(path) || path.startsWith('//')) {
    throw new Error('Environment port paths cannot replace the target origin.')
  }
  const protocol = target.protocol ?? 'http'
  const origin = `${protocol}://localhost:${String(target.port)}`
  const resolved = new URL(path, `${origin}/`)
  if (resolved.origin !== origin) {
    throw new Error('Environment port paths cannot replace the target origin.')
  }
  return resolved.href
}

export function resolveBrowserPreviewAutomationNavigationUrl(
  input: BrowserPreviewAutomationNavigateInput,
) {
  const targetCount = Number(input.url !== undefined) + Number(input.target !== undefined)
  if (targetCount !== 1) throw new Error('Provide exactly one browser navigation target.')
  validateBrowserPreviewAutomationTimeout(input.timeoutMs)
  if (input.url !== undefined) return normalizeAddress(input.url)
  if (input.target?.kind === 'url') return normalizeAddress(input.target.url)
  if (input.target?.kind === 'environment-port') return environmentPortUrl(input.target)
  throw new Error('Browser navigation target is missing.')
}

export function resolveBrowserPreviewAutomationViewport(
  input: BrowserPreviewAutomationResizeInput,
): BrowserPreviewViewport {
  return matchBy(input, 'mode')
    .with('fill', () => ({ mode: 'fill' }))
    .with('freeform', ({ width, height }) => {
      if (!isValidBrowserPreviewViewportSize(width, height)) {
        throw new Error('Freeform browser preview dimensions are outside the supported bounds.')
      }
      return { mode: 'fixed', width, height, presetId: null }
    })
    .with('preset', ({ preset, orientation }) => browserPreviewPresetViewport(preset, orientation))
    .exhaustive()
}

function validateTargetSelectors(input: { readonly selector?: string; readonly locator?: string }) {
  if (input.selector !== undefined && input.locator !== undefined) {
    throw new Error('Provide at most one of selector or locator.')
  }
  if (input.selector !== undefined && input.selector.trim().length === 0) {
    throw new Error('Browser preview selector cannot be blank.')
  }
  if (input.locator !== undefined && input.locator.trim().length === 0) {
    throw new Error('Browser preview locator cannot be blank.')
  }
}

export function validateBrowserPreviewAutomationClick(input: BrowserPreviewAutomationClickInput) {
  validateTargetSelectors(input)
  validateBrowserPreviewAutomationTimeout(input.timeoutMs)
  const selectors = Number(input.selector !== undefined) + Number(input.locator !== undefined)
  const hasX = input.x !== undefined
  const hasY = input.y !== undefined
  if (hasX !== hasY) throw new Error('Browser preview click coordinates require both x and y.')
  if (hasX && (!Number.isFinite(input.x) || !Number.isFinite(input.y))) {
    throw new Error('Browser preview click coordinates must be finite.')
  }
  if (selectors + Number(hasX && hasY) !== 1) {
    throw new Error('Provide exactly one browser preview click target.')
  }
}

export function validateBrowserPreviewAutomationType(input: BrowserPreviewAutomationTypeInput) {
  validateTargetSelectors(input)
  validateBrowserPreviewAutomationTimeout(input.timeoutMs)
}

export function validateBrowserPreviewAutomationScroll(input: BrowserPreviewAutomationScrollInput) {
  validateTargetSelectors(input)
  if (input.deltaX === undefined && input.deltaY === undefined) {
    throw new Error('Provide deltaX, deltaY, or both.')
  }
  if (!Number.isFinite(input.deltaX ?? 0) || !Number.isFinite(input.deltaY ?? 0)) {
    throw new Error('Browser preview scroll deltas must be finite.')
  }
}

export function validateBrowserPreviewAutomationWait(input: BrowserPreviewAutomationWaitInput) {
  validateTargetSelectors(input)
  validateBrowserPreviewAutomationTimeout(input.timeoutMs)
  if (
    input.selector === undefined &&
    input.locator === undefined &&
    input.text === undefined &&
    input.urlIncludes === undefined
  ) {
    throw new Error('Provide at least one browser preview wait condition.')
  }
}
