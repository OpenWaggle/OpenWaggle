import { Buffer } from 'node:buffer'
import type {
  BrowserPreviewAutomationActionEvent,
  BrowserPreviewAutomationConsoleEntry,
  BrowserPreviewAutomationElement,
  BrowserPreviewAutomationNetworkEntry,
  BrowserPreviewAutomationSnapshot,
} from '@shared/types/browser-preview-automation'
import { BROWSER_PREVIEW_AUTOMATION_LIMITS } from '@shared/types/browser-preview-automation'

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

/** Keeps snapshot metadata below Pi's result ceiling while retaining the native PNG separately. */
export function boundedBrowserPreviewSnapshotSummary(snapshot: BrowserPreviewAutomationSnapshot) {
  let visibleText = snapshot.visibleText
  let interactiveElements = snapshot.interactiveElements.map(sanitizeElement)
  let accessibilityTree = snapshot.accessibilityTree
  let consoleEntries = snapshot.consoleEntries.map(sanitizeConsole)
  let networkEntries = snapshot.networkEntries.map(sanitizeNetwork)
  let actionTimeline = snapshot.actionTimeline.map(sanitizeAction)
  const truncatedFields = new Set<string>()

  const build = () => ({
    url: bounded(snapshot.url, URL_LENGTH),
    title: bounded(snapshot.title, TITLE_LENGTH),
    loading: snapshot.loading,
    visibleText,
    interactiveElements,
    accessibilityTree,
    consoleEntries,
    networkEntries,
    actionTimeline,
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
