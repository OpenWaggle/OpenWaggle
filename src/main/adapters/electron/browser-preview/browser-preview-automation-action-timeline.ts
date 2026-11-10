import type { BrowserPreviewAutomationActionEvent } from '@shared/types/browser-preview-automation'
import { BROWSER_PREVIEW_AUTOMATION_LIMITS } from '@shared/types/browser-preview-automation'

const ERROR_LENGTH = 1_024

export function appendBrowserPreviewAutomationAction(
  timeline: BrowserPreviewAutomationActionEvent[],
  action: BrowserPreviewAutomationActionEvent,
) {
  timeline.push(action)
  if (timeline.length > BROWSER_PREVIEW_AUTOMATION_LIMITS.ACTION_EVENTS) {
    timeline.splice(0, timeline.length - BROWSER_PREVIEW_AUTOMATION_LIMITS.ACTION_EVENTS)
  }
}

export function replaceBrowserPreviewAutomationAction(
  timeline: BrowserPreviewAutomationActionEvent[],
  action: BrowserPreviewAutomationActionEvent,
) {
  const index = timeline.findIndex((candidate) => candidate.id === action.id)
  if (index >= 0) timeline[index] = action
}

export function browserPreviewAutomationActionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.length <= ERROR_LENGTH ? message : `${message.slice(0, ERROR_LENGTH)}…`
}
