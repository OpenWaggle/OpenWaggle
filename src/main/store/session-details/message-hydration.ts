import { matchBy } from '@diegogbrisa/ts-match'
import { Schema, type SchemaType, safeDecodeUnknown } from '@shared/schema'
import { messageScheduledTaskOriginSchema } from '@shared/schemas/message-scheduled-task-origin'
import { toolCallRequestSchema, toolCallResultSchema } from '@shared/schemas/message'
import { waggleInvocationMetadataSchema, waggleMetadataSchema } from '@shared/schemas/waggle'
import type { Message } from '@shared/types/agent'
import { MessageId, SessionId, SupportedModelId } from '@shared/types/brand'
import { buildPiTranscriptPath } from '@shared/utils/session-entry-paths'
import { isRecord } from '@shared/utils/validation'
import { createLogger } from '../../logger'
import { MESSAGE_ENTRY_TYPE, TOOL_RESULT_KIND } from './constants'
import { describeError } from './errors'
import { normalizeModelId, parseJsonValue } from './json'
import type { SessionNodeRow, SessionRow } from './types'

const logger = createLogger('session-details')

const messagePartSchema = Schema.Union(
  Schema.Struct({ type: Schema.Literal('text'), text: Schema.String }),
  Schema.Struct({ type: Schema.Literal('reasoning'), text: Schema.String }),
  Schema.Struct({ type: Schema.Literal('thinking'), text: Schema.String }),
  Schema.Struct({
    type: Schema.Literal('attachment'),
    attachment: Schema.Struct({
      id: Schema.String,
      kind: Schema.Literal('text', 'image', 'pdf'),
      origin: Schema.optionalWith(
        Schema.Literal('user-file', 'auto-paste-text', 'browser-preview', 'session-resource'),
        { exact: true },
      ),
      name: Schema.String,
      path: Schema.String,
      mimeType: Schema.String,
      sizeBytes: Schema.Number,
      contentSha256: Schema.optionalWith(Schema.String, { exact: true }),
      extractedText: Schema.String,
    }),
  }),
  Schema.Struct({ type: Schema.Literal('tool-call'), toolCall: toolCallRequestSchema }),
  Schema.Struct({ type: Schema.Literal('tool-result'), toolResult: toolCallResultSchema }),
)

const messageMetadataSchema = Schema.Struct({
  durableTextSha256: Schema.optionalWith(Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)), {
    exact: true,
  }),
  scheduledTask: Schema.optionalWith(messageScheduledTaskOriginSchema, { exact: true }),
  hiveWake: Schema.optionalWith(Schema.Literal(true), { exact: true }),
  visualizationSessionId: Schema.optionalWith(Schema.String, { exact: true }),
  waggle: Schema.optionalWith(waggleMetadataSchema, { exact: true }),
  waggleInvocation: Schema.optionalWith(waggleInvocationMetadataSchema, { exact: true }),
  selectedModel: Schema.optionalWith(Schema.String, { exact: true }),
  stopReason: Schema.optionalWith(Schema.String, { exact: true }),
  errorMessage: Schema.optionalWith(Schema.NullOr(Schema.String), { exact: true }),
  omittedFromContext: Schema.optionalWith(Schema.Boolean, { exact: true }),
})

const messageNodeContentSchema = Schema.Struct({
  parts: Schema.mutable(Schema.Array(messagePartSchema)),
  model: Schema.optionalWith(Schema.NullOr(Schema.String), { exact: true }),
})

type ParsedPart = SchemaType<typeof messagePartSchema>

function transformPart(part: ParsedPart) {
  return matchBy(part, 'type')
    .with('text', (value) => ({ type: 'text', text: value.text }))
    .with('reasoning', (value) => ({ type: 'reasoning', text: value.text }))
    .with('thinking', (value) => ({ type: 'reasoning', text: value.text }))
    .with('attachment', (value) => ({ type: 'attachment', attachment: value.attachment }))
    .with('tool-call', (value) => ({ type: 'tool-call', toolCall: value.toolCall }))
    .with('tool-result', (value) => ({ type: 'tool-result', toolResult: value.toolResult }))
    .exhaustive()
}

function hydrateMessageMetadata(raw: string) {
  const parsedMetadata = safeDecodeUnknown(messageMetadataSchema, parseJsonValue(raw) ?? {})
  if (!parsedMetadata.success || !parsedMetadata.data) {
    return undefined
  }

  const {
    stopReason,
    errorMessage,
    omittedFromContext,
    visualizationSessionId,
    selectedModel,
    waggle,
    ...metadata
  } = parsedMetadata.data
  // An attempt Pi retried and dropped from the context is not the turn's failure.
  const failed = stopReason === 'error' && errorMessage && omittedFromContext !== true
  return {
    ...metadata,
    ...(failed ? { error: errorMessage } : {}),
    ...(visualizationSessionId
      ? { visualizationSessionId: SessionId(visualizationSessionId) }
      : {}),
    ...(selectedModel ? { selectedModel: SupportedModelId(selectedModel) } : {}),
    ...(waggle ? { waggle: hydrateWaggleMetadata(waggle) } : {}),
  }
}

function hydrateWaggleMetadata(waggle: SchemaType<typeof waggleMetadataSchema>) {
  const { agentModel, sessionId, ...rest } = waggle
  return {
    ...rest,
    ...(agentModel ? { agentModel: SupportedModelId(agentModel) } : {}),
    ...(sessionId === undefined ? {} : { sessionId }),
  }
}

export function hydrateSessionMessage(row: SessionNodeRow) {
  const parsedContent = safeDecodeUnknown(
    messageNodeContentSchema,
    parseJsonValue(row.content_json),
  )
  if (!parsedContent.success) {
    throw new Error(
      `Invalid message node content for ${row.id}: ${parsedContent.issues.join('; ')}`,
    )
  }

  const modelId = parsedContent.data.model ? normalizeModelId(parsedContent.data.model) : undefined

  return {
    id: MessageId(row.id),
    role: row.role ?? 'assistant',
    parts: parsedContent.data.parts.map(transformPart),
    ...(modelId ? { model: SupportedModelId(modelId) } : {}),
    metadata: {
      ...hydrateMessageMetadata(row.metadata_json),
      sessionNodeCreatedOrder: row.created_order,
    },
    createdAt: row.timestamp_ms,
  }
}

function getStringField(value: unknown, key: string) {
  if (!isRecord(value)) {
    return null
  }

  const field = value[key]
  return typeof field === 'string' && field.trim().length > 0 ? field : null
}

function getNumberField(value: unknown, key: string) {
  if (!isRecord(value)) {
    return null
  }

  const field = value[key]
  return typeof field === 'number' && Number.isFinite(field) ? field : null
}

function getCompactionReason(value: unknown) {
  const reason = getStringField(value, 'reason')
  return reason === 'manual' || reason === 'threshold' || reason === 'overflow' ? reason : undefined
}

export function hydrateStructuralSessionMessage(row: SessionNodeRow) {
  const content = parseJsonValue(row.content_json)
  const summary = getStringField(content, 'summary')
  if (!summary) {
    return null
  }

  if (row.kind === 'branch_summary') {
    return {
      id: MessageId(row.id),
      role: 'assistant',
      parts: [{ type: 'text', text: `Branch summary\n\n${summary}` }],
      metadata: { branchSummary: { summary } },
      createdAt: row.timestamp_ms,
    } satisfies Message
  }

  if (row.kind === 'compaction_summary') {
    const tokensBefore = getNumberField(content, 'tokensBefore')
    const reason = getCompactionReason(content)
    return {
      id: MessageId(row.id),
      role: 'assistant',
      parts: [{ type: 'text', text: `Compaction summary\n\n${summary}` }],
      ...(tokensBefore !== null
        ? {
            metadata: {
              compactionSummary: { summary, tokensBefore, ...(reason ? { reason } : {}) },
            },
          }
        : {}),
      createdAt: row.timestamp_ms,
    } satisfies Message
  }

  return null
}

export function hydrateSessionMessages(nodeRows: readonly SessionNodeRow[]) {
  const messages: Message[] = []

  for (const row of nodeRows) {
    if (row.kind === 'branch_summary' || row.kind === 'compaction_summary') {
      const structuralMessage = hydrateStructuralSessionMessage(row)
      if (structuralMessage) messages.push(structuralMessage)
      continue
    }

    if (row.kind === TOOL_RESULT_KIND) {
      messages.push(hydrateSessionMessage(row))
      continue
    }

    if (
      row.pi_entry_type !== MESSAGE_ENTRY_TYPE &&
      row.kind !== 'user_message' &&
      row.kind !== 'assistant_message'
    ) {
      continue
    }

    if (row.role !== null) messages.push(hydrateSessionMessage(row))
  }

  return messages
}

/** The active branch the transcript shows, compacted history included (ADR 0048). */
export function getActivePathRows(
  activeNodeId: string | null,
  nodeRows: readonly SessionNodeRow[],
) {
  return buildPiTranscriptPath(activeNodeId, nodeRows, {
    getId: (row) => row.id,
    getParentId: (row) => row.parent_id,
  })
}

export function logSessionHydrationFailure(sessionRow: SessionRow, error: unknown) {
  logger.warn('Failed to hydrate session-backed session', {
    sessionId: sessionRow.id,
    error: describeError(error),
  })
}
