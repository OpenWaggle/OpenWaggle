import { Buffer } from 'node:buffer'
import type {
  BrowserPreviewAutomationActionEvent,
  BrowserPreviewAutomationConsoleEntry,
  BrowserPreviewAutomationElement,
  BrowserPreviewAutomationNetworkEntry,
  BrowserPreviewAutomationSnapshot,
} from '@shared/types/browser-preview-automation'
import { BROWSER_PREVIEW_AUTOMATION_LIMITS } from '@shared/types/browser-preview-automation'
import type { BrowserPreviewSnapshotPart } from './browser-preview-automation-schemas-core'

const MIN_VISIBLE_TEXT_LENGTH = 1_024
const TITLE_LENGTH = 512
const ELEMENT_NAME_LENGTH = 512
const SELECTOR_LENGTH = 2_048
const DIAGNOSTIC_TEXT_LENGTH = 4_096
const URL_LENGTH = 8_192
const REDUCTION_DIVISOR = 2

function bounded(value: string, maximum: number) {
  return value.length <= maximum ? value : `${value.slice(0, maximum)}…`
}

function sanitizeElement(element: BrowserPreviewAutomationElement) {
  return {
    ...element,
    tag: bounded(element.tag, TITLE_LENGTH),
    role: element.role === null ? null : bounded(element.role, TITLE_LENGTH),
    name: bounded(element.name, ELEMENT_NAME_LENGTH),
    selector: bounded(element.selector, SELECTOR_LENGTH),
  }
}

function sanitizeConsole(entry: BrowserPreviewAutomationConsoleEntry) {
  return {
    ...entry,
    level: bounded(entry.level, TITLE_LENGTH),
    text: bounded(entry.text, DIAGNOSTIC_TEXT_LENGTH),
    ...(entry.source ? { source: bounded(entry.source, URL_LENGTH) } : {}),
  }
}

function sanitizeNetwork(entry: BrowserPreviewAutomationNetworkEntry) {
  return {
    ...entry,
    url: bounded(entry.url, URL_LENGTH),
    method: bounded(entry.method, TITLE_LENGTH),
    ...(entry.errorText ? { errorText: bounded(entry.errorText, DIAGNOSTIC_TEXT_LENGTH) } : {}),
  }
}

function sanitizeAction(entry: BrowserPreviewAutomationActionEvent) {
  return {
    ...entry,
    id: bounded(entry.id, TITLE_LENGTH),
    action: bounded(entry.action, TITLE_LENGTH),
    ...(entry.error ? { error: bounded(entry.error, DIAGNOSTIC_TEXT_LENGTH) } : {}),
  }
}

function halve<T>(values: readonly T[], keepNewest: boolean) {
  const nextLength = Math.floor(values.length / REDUCTION_DIVISOR)
  if (nextLength === 0) return []
  return keepNewest ? values.slice(-nextLength) : values.slice(0, nextLength)
}

/**
 * How many entries each part left out of the snapshot holds, so the model knows when asking for
 * it is worth it, for example console errors after a failed click.
 */
function omittedParts(
  snapshot: BrowserPreviewAutomationSnapshot,
  included: ReadonlySet<BrowserPreviewSnapshotPart>,
) {
  const counts = {
    ...(!included.has('accessibility') && snapshot.accessibilityTree !== null
      ? { accessibility: 1 }
      : {}),
    ...(!included.has('console') && snapshot.consoleEntries.length > 0
      ? { console: snapshot.consoleEntries.length }
      : {}),
    ...(!included.has('network') && snapshot.networkEntries.length > 0
      ? { network: snapshot.networkEntries.length }
      : {}),
    ...(!included.has('actions') && snapshot.actionTimeline.length > 0
      ? { actions: snapshot.actionTimeline.length }
      : {}),
  }
  return Object.keys(counts).length > 0 ? { omitted: counts } : {}
}

/**
 * Keeps snapshot metadata below Pi's result ceiling while retaining the native PNG separately.
 * Visible text and interactive elements are always sent; the accessibility tree, console,
 * network, and action history only when `include` names them (C16 of the v1 performance research:
 * a full snapshot is up to 64 KB of JSON).
 */
export function boundedBrowserPreviewSnapshotSummary(
  snapshot: BrowserPreviewAutomationSnapshot,
  include: readonly BrowserPreviewSnapshotPart[] = [],
) {
  const included = new Set(include)
  let visibleText = snapshot.visibleText
  let interactiveElements = snapshot.interactiveElements.map(sanitizeElement)
  let accessibilityTree = included.has('accessibility') ? snapshot.accessibilityTree : null
  let consoleEntries = included.has('console') ? snapshot.consoleEntries.map(sanitizeConsole) : []
  let networkEntries = included.has('network') ? snapshot.networkEntries.map(sanitizeNetwork) : []
  let actionTimeline = included.has('actions') ? snapshot.actionTimeline.map(sanitizeAction) : []
  const truncatedFields = new Set<string>()
  const omitted = omittedParts(snapshot, included)

  const build = () => ({
    url: bounded(snapshot.url, URL_LENGTH),
    title: bounded(snapshot.title, TITLE_LENGTH),
    loading: snapshot.loading,
    visibleText,
    interactiveElements,
    ...(included.has('accessibility') ? { accessibilityTree } : {}),
    ...(included.has('console') ? { consoleEntries } : {}),
    ...(included.has('network') ? { networkEntries } : {}),
    ...(included.has('actions') ? { actionTimeline } : {}),
    ...omitted,
    screenshot: {
      mimeType: snapshot.screenshot.mimeType,
      width: snapshot.screenshot.width,
      height: snapshot.screenshot.height,
    },
    ...(truncatedFields.size > 0 ? { truncatedFields: [...truncatedFields] } : {}),
  })

  const reduce = () => {
    if (accessibilityTree !== null) {
      accessibilityTree = null
      truncatedFields.add('accessibilityTree')
      return true
    }
    if (networkEntries.length > 0) {
      networkEntries = halve(networkEntries, true)
      truncatedFields.add('networkEntries')
      return true
    }
    if (consoleEntries.length > 0) {
      consoleEntries = halve(consoleEntries, true)
      truncatedFields.add('consoleEntries')
      return true
    }
    if (actionTimeline.length > 0) {
      actionTimeline = halve(actionTimeline, true)
      truncatedFields.add('actionTimeline')
      return true
    }
    if (interactiveElements.length > 0) {
      interactiveElements = halve(interactiveElements, false)
      truncatedFields.add('interactiveElements')
      return true
    }
    if (visibleText.length > MIN_VISIBLE_TEXT_LENGTH) {
      visibleText = bounded(
        visibleText,
        Math.max(MIN_VISIBLE_TEXT_LENGTH, Math.floor(visibleText.length / REDUCTION_DIVISOR)),
      )
      truncatedFields.add('visibleText')
      return true
    }
    return false
  }

  while (
    Buffer.byteLength(JSON.stringify(build())) > BROWSER_PREVIEW_AUTOMATION_LIMITS.RESULT_BYTES
  ) {
    if (!reduce()) {
      throw new Error('Browser preview snapshot metadata exceeded the 64 KB result limit.')
    }
  }

  return build()
}
