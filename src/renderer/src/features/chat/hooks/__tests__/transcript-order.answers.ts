import type { MessagePart } from '@shared/types/agent'
import { ToolCallId } from '@shared/types/brand'
import type { AgentAssistantMessageEvent } from '@shared/types/stream'

/*
 * What an assistant answer streams, by shape: its text alone; a thought before each of two text
 * segments, the later contained in the earlier (as "…, then report back" and "report back"); the two
 * segments around an empty thought (a reasoning item with no summary, redacted thinking); or
 * around a tool call. A stall can lose a thought or tool call between the segments from the live
 * view only, and the Host buffer and the live view must still be merged segment by segment.
 */

export type AnswerShape = 'plain' | 'reasoning' | 'emptyThought' | 'toolBetween'

export interface AnswerSegment {
  readonly kind: 'thinking' | 'text' | 'tool'
  /** The text, or a tool call's id. */
  readonly content: string
}

export function answerSegments(text: string, shape: AnswerShape, toolCallId: string) {
  const around = (between: AnswerSegment): AnswerSegment[] => [
    { kind: 'text', content: `${text} then report back` },
    between,
    { kind: 'text', content: 'report back' },
  ]
  const segments: Record<AnswerShape, () => AnswerSegment[]> = {
    plain: () => [{ kind: 'text', content: text }],
    reasoning: () => [
      { kind: 'thinking', content: `thinking about ${text}` },
      ...around({ kind: 'thinking', content: 'checking it' }),
    ],
    emptyThought: () => around({ kind: 'thinking', content: '' }),
    toolBetween: () => around({ kind: 'tool', content: toolCallId }),
  }
  return segments[shape]()
}

/** The answer's display key text: its thoughts and texts in order, the same live and persisted. */
export function segmentsKey(segments: readonly AnswerSegment[]) {
  const keyed = segments.filter((segment) => segmentKey(segment) !== undefined)
  return keyed
    .map((segment, index) => {
      // Texts in a row read as one, as `answerContentKey` reads them: the live view joins two
      // text blocks in a row, and the split is its to show, not the transcript's to order.
      const joined = segment.kind === 'text' && keyed[index - 1]?.kind === 'text'
      return `${index === 0 || joined ? '' : ' '}${segmentKey(segment) ?? ''}`
    })
    .join('')
}

/** A segment's part of the key; a tool call and an empty thought have none. */
export function segmentKey(segment: AnswerSegment) {
  if (segment.kind === 'tool' || segment.content === '') return undefined
  return segment.kind === 'thinking' ? `[thinking: ${segment.content}]` : segment.content
}

const TOOL = { toolName: 'bash' }

function segmentEvents(segment: AnswerSegment, contentIndex: number): AgentAssistantMessageEvent[] {
  if (segment.kind === 'tool') {
    const call = { contentIndex, toolCallId: segment.content, ...TOOL }
    const input = { command: segment.content }
    return [
      { type: 'toolcall_start', ...call, input },
      { type: 'toolcall_end', ...call, input },
    ]
  }
  const deltas = segment.content === '' ? [] : segment.content.split(/(?= )/)
  const type = segment.kind === 'thinking' ? 'thinking_delta' : 'text_delta'
  const streamed = deltas.map((delta) => ({ type, contentIndex, delta }) as const)
  if (segment.kind === 'text') return streamed
  return [
    { type: 'thinking_start', contentIndex },
    ...streamed,
    { type: 'thinking_end', contentIndex, content: segment.content },
  ]
}

/** The answer's events as the model streams them: each segment, its text word by word. */
export function answerEvents(segments: readonly AnswerSegment[]) {
  return segments.flatMap(segmentEvents)
}

/** The persisted parts of the answer's segments. */
export function segmentParts(segments: readonly AnswerSegment[]): MessagePart[] {
  return segments.map((segment): MessagePart => {
    if (segment.kind === 'tool') {
      const id = ToolCallId(segment.content)
      return {
        type: 'tool-call',
        toolCall: { id, name: TOOL.toolName, args: { command: segment.content } },
      }
    }
    return { type: segment.kind === 'thinking' ? 'reasoning' : 'text', text: segment.content }
  })
}

/** The tool calls an answer makes inside its segments. */
export function inlineToolCallIds(segments: readonly AnswerSegment[]) {
  return segments.flatMap((segment) => (segment.kind === 'tool' ? [segment.content] : []))
}

/**
 * An assistant log entry's content: its key text, the tool calls it made (between its segments,
 * then after them) and its segments.
 */
export function answerContent(
  text: string,
  index: string,
  options: { readonly shape?: AnswerShape; readonly reasoning?: boolean; readonly tools?: number },
) {
  const shape = options.shape ?? (options.reasoning ? 'reasoning' : 'plain')
  const segments = answerSegments(text, shape, `tool-${index}-inline`)
  const after = Array.from(
    { length: options.tools ?? 0 },
    (_, tool) => `tool-${index}-${String(tool)}`,
  )
  return {
    text: segmentsKey(segments),
    toolCallIds: [...inlineToolCallIds(segments), ...after],
    segments,
  }
}

/**
 * Streams an answer's events (`beforeDelta` before each), then ends it unless it stays `open`. The
 * last `holdLast` events and the end wait for the returned call.
 */
export function streamAnswer(
  events: readonly AgentAssistantMessageEvent[],
  stream: {
    readonly update: (event: AgentAssistantMessageEvent) => void
    readonly end: () => void
    readonly beforeDelta?: (index: number, count: number) => void
    readonly holdLast?: number
    readonly open?: boolean
  },
): (() => void) | undefined {
  const streamFrom = (from: number, to: number) => {
    for (const [index, event] of events.slice(from, to).entries()) {
      stream.beforeDelta?.(from + index, events.length)
      stream.update(event)
    }
  }
  const held = Math.min(stream.holdLast ?? 0, events.length)
  streamFrom(0, events.length - held)
  const finish = () => {
    streamFrom(events.length - held, events.length)
    if (!stream.open) stream.end()
  }
  if (held > 0) return finish
  finish()
  return undefined
}
