import type { DesktopNotificationReason } from '../types/desktop-notification'

/** A preview is one line: enough to recognise the request or reply, never a transcript. */
export const DESKTOP_NOTIFICATION_PREVIEW_MAX_LENGTH = 160

/** The app's own words for what happened, the body of a Desktop notification. */
export const DESKTOP_NOTIFICATION_BODIES: Readonly<Record<DesktopNotificationReason, string>> = {
  'awaiting-approval': 'Waiting for your approval',
  'awaiting-answer': 'Waiting for your answer',
  stuck: 'Stuck — no agent will pick it up',
  completed: 'Ready to read',
  failed: 'Run failed',
  'interaction-timeout': 'Stopped waiting for your answer',
  'host-loss': 'Interrupted — can be resumed',
  'agent-error': 'Agent error',
  'scheduled-task-attention': 'Scheduled task needs attention',
}

/** The last path segment, as the sidebar names a project without a display name. */
export function projectNameFromPath(projectPath: string) {
  const segments = projectPath.split(/[\\/]+/).filter((segment) => segment.length > 0)
  return segments.at(-1) ?? projectPath
}

/** `Fix login race · OpenWaggle`, and for a Worker `· Worker of ⟨parent⟩`. */
export function desktopNotificationTitle(input: {
  readonly title: string
  readonly projectName?: string | null
  readonly parentTitle?: string | null
}) {
  const parts = [input.title.trim() || 'Untitled session']
  if (input.projectName) parts.push(input.projectName)
  if (input.parentTitle) parts.push(`Worker of ${input.parentTitle}`)
  return parts.join(' · ')
}

/** The first non-empty line, collapsed and cut to one preview line. */
export function desktopNotificationPreview(text: string | null | undefined) {
  if (!text) return undefined
  const line = text
    .split('\n')
    .map((candidate) => candidate.replace(/\s+/g, ' ').trim())
    .find((candidate) => candidate.length > 0)
  if (!line) return undefined
  return line.length > DESKTOP_NOTIFICATION_PREVIEW_MAX_LENGTH
    ? `${line.slice(0, DESKTOP_NOTIFICATION_PREVIEW_MAX_LENGTH - 1)}…`
    : line
}
