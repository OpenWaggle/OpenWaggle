import { matchBy } from '@diegogbrisa/ts-match'
import { safeDecodeUnknown, Schema, type SchemaType } from '@shared/schema'
import type { SessionId } from '@shared/types/brand'
import type { JsonValue } from '@shared/types/json'
import { decodeInlineVisualizationState } from '../state/inline-visualization-state'
import {
  openBrokeredVisualizationLink,
  saveBrokeredVisualizationDownload,
  sendBrokeredVisualizationFollowUp,
} from './inline-visualization-host'

const MIN_VISUALIZATION_HEIGHT = 1
const MAX_VISUALIZATION_HEIGHT = 10_000
const MIN_CAPABILITY_LENGTH = 16

function boundedVisualizationHeight(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.ceil(Math.min(MAX_VISUALIZATION_HEIGHT, Math.max(MIN_VISUALIZATION_HEIGHT, value)))
}

interface FrameMessageContext {
  readonly interactionSessionId: SessionId | null
  readonly capability: { current: string | null }
  readonly brokerPending: { current: boolean }
  readonly acceptMessage: () => boolean
  readonly clearHealthCheckTimeout: () => void
  readonly flushStateChange: () => void
  readonly sendTheme: () => void
  readonly postToFrame: (message: FollowUpResultMessage) => void
  readonly setErrorReason: (reason: string) => void
  readonly setHeight: (height: number) => void
  readonly onDismiss: () => void
  readonly scheduleStateChange: (state: JsonValue | null) => void
}

interface FollowUpResultMessage {
  readonly type: 'openwaggle:inline-visualization:follow-up-result'
  readonly requestId: string
  readonly accepted: boolean
}

const MESSAGE_PREFIX = 'openwaggle:inline-visualization:'

/** A message the visualization frame sends once it holds its capability. */
function capabilityMessage<const TName extends string, TFields extends Schema.Struct.Fields>(
  name: TName,
  fields: TFields,
) {
  return Schema.Struct({
    type: Schema.Literal(`${MESSAGE_PREFIX}${name}`),
    capability: Schema.String,
    ...fields,
  })
}

/**
 * Messages from the sandboxed visualization frame, which runs model-written code. A message whose
 * fields do not decode is ignored, as the hand-written checks did before.
 */
const frameMessageSchema = Schema.Union(
  Schema.Struct({
    type: Schema.Literal(`${MESSAGE_PREFIX}bootstrap`),
    capability: Schema.String.pipe(Schema.minLength(MIN_CAPABILITY_LENGTH)),
  }),
  capabilityMessage('ready', {}),
  capabilityMessage('open-link', { url: Schema.String }),
  capabilityMessage('follow-up', {
    prompt: Schema.String,
    requestId: Schema.String,
    title: Schema.optionalWith(Schema.String, { exact: true }),
  }),
  capabilityMessage('download', {
    suggestedName: Schema.String,
    mimeType: Schema.String,
    base64Data: Schema.String,
  }),
  capabilityMessage('error', { reason: Schema.String }),
  capabilityMessage('resource-limit', {}),
  capabilityMessage('resize', { height: Schema.Unknown }),
  capabilityMessage('state', { state: Schema.Unknown }),
  capabilityMessage('dismiss', {}),
)

type FrameMessage = SchemaType<typeof frameMessageSchema>
type BrokeredMessage = Exclude<FrameMessage, { readonly type: `${typeof MESSAGE_PREFIX}bootstrap` }>
type FollowUpMessage = Extract<FrameMessage, { readonly type: `${typeof MESSAGE_PREFIX}follow-up` }>
type DownloadMessage = Extract<FrameMessage, { readonly type: `${typeof MESSAGE_PREFIX}download` }>

function openLink(url: string, context: FrameMessageContext) {
  if (context.brokerPending.current) return
  context.brokerPending.current = true
  void openBrokeredVisualizationLink(url)
    .catch(() => false)
    .finally(() => {
      context.brokerPending.current = false
    })
}

function sendFollowUp(message: FollowUpMessage, context: FrameMessageContext) {
  if (context.interactionSessionId === null || context.brokerPending.current) return
  context.flushStateChange()
  context.brokerPending.current = true
  void sendBrokeredVisualizationFollowUp({
    sessionId: context.interactionSessionId,
    prompt: message.prompt,
    ...(message.title === undefined ? {} : { title: message.title }),
  })
    .then(
      (accepted) => accepted,
      () => false,
    )
    .then((accepted) => {
      context.postToFrame({
        type: 'openwaggle:inline-visualization:follow-up-result',
        requestId: message.requestId,
        accepted,
      })
    })
    .finally(() => {
      context.brokerPending.current = false
    })
}

function saveDownload(message: DownloadMessage, context: FrameMessageContext) {
  if (context.brokerPending.current) return
  context.brokerPending.current = true
  void saveBrokeredVisualizationDownload({
    suggestedName: message.suggestedName,
    mimeType: message.mimeType,
    base64Data: message.base64Data,
  })
    .catch(() => false)
    .finally(() => {
      context.brokerPending.current = false
    })
}

function reportState(state: unknown, context: FrameMessageContext) {
  if (state === null) {
    context.scheduleStateChange(null)
    return
  }
  const decoded = decodeInlineVisualizationState(state)
  if (decoded !== null) context.scheduleStateChange(decoded)
}

function handleBrokeredMessage(message: BrokeredMessage, context: FrameMessageContext) {
  matchBy(message, 'type')
    .with(`${MESSAGE_PREFIX}ready`, () => {
      context.clearHealthCheckTimeout()
      context.sendTheme()
    })
    .with(`${MESSAGE_PREFIX}open-link`, (link) => {
      openLink(link.url, context)
    })
    .with(`${MESSAGE_PREFIX}follow-up`, (followUp) => {
      sendFollowUp(followUp, context)
    })
    .with(`${MESSAGE_PREFIX}download`, (download) => {
      saveDownload(download, context)
    })
    .with(`${MESSAGE_PREFIX}error`, (error) => {
      context.setErrorReason(error.reason)
    })
    .with(`${MESSAGE_PREFIX}resource-limit`, () => {
      context.setErrorReason('resource-limit')
    })
    .with(`${MESSAGE_PREFIX}resize`, (resize) => {
      const height = boundedVisualizationHeight(resize.height)
      if (height !== null) context.setHeight(height)
    })
    .with(`${MESSAGE_PREFIX}state`, (state) => {
      reportState(state.state, context)
    })
    .with(`${MESSAGE_PREFIX}dismiss`, () => {
      context.onDismiss()
    })
    .exhaustive()
}

export function handleInlineVisualizationFrameMessage(
  value: unknown,
  context: FrameMessageContext,
) {
  if (!context.acceptMessage()) return
  const decoded = safeDecodeUnknown(frameMessageSchema, value)
  if (!decoded.success) return
  const message = decoded.data
  if (message.type === `${MESSAGE_PREFIX}bootstrap`) {
    if (context.capability.current === null) context.capability.current = message.capability
    return
  }
  if (context.capability.current === null || message.capability !== context.capability.current) {
    return
  }
  handleBrokeredMessage(message, context)
}
