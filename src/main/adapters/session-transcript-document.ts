import { match, P } from '@diegogbrisa/ts-match'

const MAX_TRANSCRIPT_CHUNK_LENGTH = 12_000
const SEARCHABLE_CUSTOM_MESSAGE_TYPES = new Set([
  'openwaggle-delegation-specification-update',
  'openwaggle-orchestration-update',
  'openwaggle-peer-agent-report',
])

export interface SessionTranscriptDocumentSource {
  readonly kind: string
  readonly role: string | null
  readonly contentJson: string
}

function normalized(value: string) {
  const text = value.trim()
  return text ? text : null
}

function visiblePartText(part: unknown) {
  return match(part)
    .with({ type: 'text', text: P.select('value', P.string) }, ({ value }) => normalized(value))
    .with(
      { type: 'attachment', attachment: { name: P.select('value', P.string) } },
      { type: 'tool-call', toolCall: { name: P.select('value', P.string) } },
      ({ value }) => normalized(value),
    )
    .with(
      {
        type: 'tool-result',
        toolResult: {
          name: P.select('name', P.string),
          isError: P.select('isError', P.boolean),
        },
      },
      ({ name, isError }) => `${name.trim()} ${isError ? 'failed' : 'completed'}`.trim(),
    )
    .otherwise(() => null)
}

function customMessageText(content: unknown) {
  return match(content)
    .with(
      {
        customType: P.select('customType', P.string),
        content: P.select('content', P.string),
        display: true,
      },
      ({ customType, content }) =>
        SEARCHABLE_CUSTOM_MESSAGE_TYPES.has(customType) ? [normalized(content)] : [],
    )
    .otherwise(() => [])
}

function structuralSummary(kind: string, content: unknown) {
  if (kind !== 'branch_summary' && kind !== 'compaction_summary') return []
  return match(content)
    .with({ summary: P.select('summary', P.string) }, ({ summary }) => [normalized(summary)])
    .otherwise(() => [])
}

function messageText(source: SessionTranscriptDocumentSource, content: unknown) {
  if (source.role !== 'user' && source.role !== 'assistant' && source.kind !== 'tool_result') {
    return []
  }
  return match(content)
    .with({ text: P.select('text', P.string) }, ({ text }) => [normalized(text)])
    .with({ parts: P.select('parts', P.array(P._)) }, ({ parts }) => parts.map(visiblePartText))
    .otherwise(() => [])
}

/**
 * Produces one bounded semantic transcript chunk from a durable node.
 * Deliberately excludes reasoning, tool arguments/results, and attachment bodies.
 */
export function sessionTranscriptDocument(source: SessionTranscriptDocumentSource) {
  try {
    const content: unknown = JSON.parse(source.contentJson)
    const visible = [
      ...messageText(source, content),
      ...structuralSummary(source.kind, content),
      ...(source.kind === 'custom' ? customMessageText(content) : []),
    ]
      .filter((value): value is string => value !== null)
      .join('\n')
    return visible.slice(0, MAX_TRANSCRIPT_CHUNK_LENGTH)
  } catch {
    return ''
  }
}
