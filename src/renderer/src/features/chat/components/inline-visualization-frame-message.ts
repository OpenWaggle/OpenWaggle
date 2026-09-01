import { match } from '@diegogbrisa/ts-match'
import type { SessionId } from '@shared/types/brand'
import { isRecord } from '@shared/utils/validation'
import {
  openBrokeredVisualizationLink,
  saveBrokeredVisualizationDownload,
  sendBrokeredVisualizationFollowUp,
} from './inline-visualization-host'

const MIN_VISUALIZATION_HEIGHT = 160
const MAX_VISUALIZATION_HEIGHT = 10_000
const MIN_CAPABILITY_LENGTH = 16

function boundedVisualizationHeight(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.ceil(Math.min(MAX_VISUALIZATION_HEIGHT, Math.max(MIN_VISUALIZATION_HEIGHT, value)))
}

interface FrameMessageContext {
  readonly sessionId: SessionId
  readonly capability: { current: string | null }
  readonly brokerPending: { current: boolean }
  readonly clearHealthCheckTimeout: () => void
  readonly sendTheme: () => void
  readonly postToFrame: (message: Record<string, unknown>) => void
  readonly setErrorReason: (reason: string) => void
  readonly setHeight: (height: number) => void
  readonly onDismiss: () => void
}

export function handleInlineVisualizationFrameMessage(
  value: unknown,
  context: FrameMessageContext,
) {
  if (!isRecord(value)) return
  if (value.type === 'openwaggle:inline-visualization:ready') {
    if (typeof value.capability !== 'string' || value.capability.length < MIN_CAPABILITY_LENGTH) {
      return
    }
    if (context.capability.current !== null) return
    context.capability.current = value.capability
    context.clearHealthCheckTimeout()
    context.sendTheme()
    return
  }
  if (value.capability !== context.capability.current || context.capability.current === null) return
  match(value.type)
    .with('openwaggle:inline-visualization:open-link', () => {
      if (typeof value.url !== 'string' || context.brokerPending.current) return
      context.brokerPending.current = true
      void openBrokeredVisualizationLink(value.url).finally(() => {
        context.brokerPending.current = false
      })
    })
    .with('openwaggle:inline-visualization:follow-up', () => {
      if (
        typeof value.prompt !== 'string' ||
        typeof value.requestId !== 'string' ||
        context.brokerPending.current
      ) {
        return
      }
      if (value.title !== undefined && typeof value.title !== 'string') return
      context.brokerPending.current = true
      void sendBrokeredVisualizationFollowUp({
        sessionId: context.sessionId,
        prompt: value.prompt,
        ...(typeof value.title === 'string' ? { title: value.title } : {}),
      })
        .then((accepted) => {
          context.postToFrame({
            type: 'openwaggle:inline-visualization:follow-up-result',
            requestId: value.requestId,
            accepted,
          })
        })
        .finally(() => {
          context.brokerPending.current = false
        })
    })
    .with('openwaggle:inline-visualization:download', () => {
      if (
        typeof value.suggestedName !== 'string' ||
        typeof value.mimeType !== 'string' ||
        typeof value.base64Data !== 'string' ||
        context.brokerPending.current
      ) {
        return
      }
      context.brokerPending.current = true
      void saveBrokeredVisualizationDownload({
        suggestedName: value.suggestedName,
        mimeType: value.mimeType,
        base64Data: value.base64Data,
      }).finally(() => {
        context.brokerPending.current = false
      })
    })
    .with('openwaggle:inline-visualization:error', () => {
      if (typeof value.reason === 'string') context.setErrorReason(value.reason)
    })
    .with('openwaggle:inline-visualization:resize', () => {
      const height = boundedVisualizationHeight(value.height)
      if (height !== null) context.setHeight(height)
    })
    .with('openwaggle:inline-visualization:dismiss', context.onDismiss)
    .otherwise(() => undefined)
}
