import type { AgentSendPayload } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import { usePreferencesStore } from '@/features/settings/state'
import { api } from '@/shared/lib/ipc'
import { withInlineVisualizationContext } from '../state/inline-visualization-state'

const MAX_EXTERNAL_LINK_LENGTH = 8_192
const MAX_FOLLOW_UP_LENGTH = 50_000
const MAX_FOLLOW_UP_TITLE_LENGTH = 250
const MAX_DOWNLOAD_NAME_LENGTH = 250
const MAX_DOWNLOAD_MIME_TYPE_LENGTH = 250
const MAX_DOWNLOAD_BASE64_LENGTH = 7_000_000
type VisualizationFollowUpDispatcher = (payload: AgentSendPayload) => Promise<boolean>
const followUpDispatchers = new Map<SessionId, VisualizationFollowUpDispatcher>()

export function registerVisualizationFollowUpDispatcher(
  sessionId: SessionId,
  dispatcher: VisualizationFollowUpDispatcher,
) {
  followUpDispatchers.set(sessionId, dispatcher)
  return () => {
    if (followUpDispatchers.get(sessionId) === dispatcher) followUpDispatchers.delete(sessionId)
  }
}

export async function deliverVisualizationFollowUp(input: {
  readonly isIdle: boolean
  readonly payload: AgentSendPayload
  readonly send: (payload: AgentSendPayload) => Promise<void>
  readonly enqueue: (payload: AgentSendPayload) => void
}) {
  if (!input.isIdle) {
    input.enqueue(input.payload)
    return true
  }
  try {
    await input.send(input.payload)
    return true
  } catch {
    return false
  }
}

const THEME_TOKEN_SOURCES = [
  ['--background', '--color-bg'],
  ['--foreground', '--color-text-primary'],
  ['--card', '--color-bg-secondary'],
  ['--card-foreground', '--color-text-primary'],
  ['--popover', '--color-bg-tertiary'],
  ['--popover-foreground', '--color-text-primary'],
  ['--primary', '--color-info-text'],
  ['--primary-foreground', '--color-bg'],
  ['--secondary', '--color-bg-hover'],
  ['--secondary-foreground', '--color-text-primary'],
  ['--muted', '--color-bg-active'],
  ['--muted-foreground', '--color-text-tertiary'],
  ['--accent', '--color-bg-active'],
  ['--accent-foreground', '--color-info-text'],
  ['--destructive', '--color-error-text'],
  ['--border', '--color-border-light'],
  ['--input', '--color-border-light'],
  ['--ring', '--color-info-text'],
  ['--blue', '--color-info-text'],
  ['--orange', '--color-warning'],
  ['--green', '--color-success'],
  ['--red', '--color-error-text'],
  ['--purple', '--color-review'],
  ['--yellow', '--color-accent'],
  ['--viz-series-1', '--color-info-text'],
  ['--viz-series-2', '--color-warning'],
  ['--viz-series-3', '--color-success'],
  ['--viz-series-4', '--color-review'],
  ['--viz-series-5', '--color-plan'],
  ['--viz-series-6', '--color-progress'],
  ['--font-sans', '--font-sans'],
  ['--font-mono', '--font-mono'],
  ['--font-size-base', '--text-sm'],
  ['--radius', '--radius-lg'],
] as const

function visualizationFontSize(value: string, rootStyles: CSSStyleDeclaration) {
  const remMatch = /^(-?(?:\d+|\d*\.\d+))rem$/u.exec(value)
  const rootPixels = Number.parseFloat(rootStyles.fontSize)
  if (remMatch?.[1] && rootStyles.fontSize.endsWith('px') && Number.isFinite(rootPixels)) {
    return `${String(Number.parseFloat(remMatch[1]) * rootPixels)}px`
  }
  return value
}

export function hostVisualizationTheme() {
  const styles = getComputedStyle(document.documentElement)
  const variables: Record<string, string> = {}
  for (const [publicName, sourceName] of THEME_TOKEN_SOURCES) {
    const value = styles.getPropertyValue(sourceName).trim()
    if (value.length > 0) {
      variables[publicName] =
        publicName === '--font-size-base' ? visualizationFontSize(value, styles) : value
    }
  }
  const colorScheme: 'light' | 'dark' = styles.colorScheme === 'light' ? 'light' : 'dark'
  const reducedMotion = document.documentElement.dataset.motion === 'reduced'
  return { colorScheme, reducedMotion, variables }
}

export async function openBrokeredVisualizationLink(value: string) {
  if (value.length > MAX_EXTERNAL_LINK_LENGTH) return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    return false
  }
  const normalizedUrl = url.toString()
  const confirmed = await api.showConfirm('Open external link?', normalizedUrl)
  if (!confirmed) return false
  await api.openExternal(normalizedUrl)
  return true
}

export async function sendBrokeredVisualizationFollowUp(input: {
  readonly sessionId: SessionId
  readonly prompt: string
  readonly title?: string
}) {
  const prompt = input.prompt.trim()
  if (prompt.length === 0 || prompt.length > MAX_FOLLOW_UP_LENGTH) return false
  const requestedTitle = input.title?.trim()
  const title =
    requestedTitle && requestedTitle.length <= MAX_FOLLOW_UP_TITLE_LENGTH
      ? requestedTitle
      : 'Send follow-up message?'
  const confirmed = await api.showConfirm(title, prompt)
  if (!confirmed) return false
  const thinkingLevel = usePreferencesStore.getState().settings.thinkingLevel
  const payload = withInlineVisualizationContext(input.sessionId, {
    text: prompt,
    thinkingLevel,
    attachments: [],
  })
  const dispatcher = followUpDispatchers.get(input.sessionId)
  return dispatcher ? dispatcher(payload) : false
}

export async function saveBrokeredVisualizationDownload(input: {
  readonly suggestedName: string
  readonly mimeType: string
  readonly base64Data: string
}) {
  if (
    input.suggestedName.length === 0 ||
    input.suggestedName.length > MAX_DOWNLOAD_NAME_LENGTH ||
    input.mimeType.length > MAX_DOWNLOAD_MIME_TYPE_LENGTH ||
    input.base64Data.length > MAX_DOWNLOAD_BASE64_LENGTH
  ) {
    return false
  }
  return api.saveInlineVisualizationDownload(input)
}

export function unavailableVisualizationMessage(reason: string) {
  if (reason === 'missing') return 'The visualization source file could not be found.'
  if (reason === 'too-large') return 'The visualization is too large to load safely.'
  if (reason === 'session-missing') return 'The visualization no longer belongs to this session.'
  if (reason === 'invalid-path') return 'The visualization source is outside this session.'
  return 'The visualization could not be loaded.'
}
