import { match, matchBy } from '@diegogbrisa/ts-match'
import { TOOL_STATE_RANK } from '@shared/constants/tool-state'
import type { UIMessagePart } from '@shared/types/chat-ui'

/*
 * The parts of an answer both a reconnect's buffer and the shown transcript hold. The buffer has
 * the whole answer up to when it was read; the shown copy may have lost events in a stall (a tool
 * call, a thinking block), and has what streamed in since. So the buffer's parts stand, and what
 * streamed in after the read (the shown parts against `baseline`, what they were then) is played
 * onto them as the live view plays a delta. Parts are matched by identity only: a tool call by id,
 * a thinking step by its step id. Text has none, and position or content matching took one
 * segment for another when the two sides split the answer differently. The buffer splits an
 * answer as the live view does and names every thought: it comes from a Host of this revision.
 */

export interface StreamingPartsBaseline {
  /** The shown parts of the answer when the buffer was read. */
  readonly parts: readonly UIMessagePart[]
  /** The buffer dropped some of the answer at its byte caps: the shown copy is the fuller one. */
  readonly degraded?: boolean
}

type TextLikePart = Extract<UIMessagePart, { readonly type: 'text' | 'thinking' }>

function toolStateRank(state: string) {
  return match(state)
    .with('complete', 'error', 'output-available', () => TOOL_STATE_RANK.TERMINAL)
    .with('executing', () => TOOL_STATE_RANK.EXECUTING)
    .with('input-complete', () => TOOL_STATE_RANK.INPUT_COMPLETE)
    .with('input-streaming', () => TOOL_STATE_RANK.INPUT_STREAMING)
    .otherwise(() => TOOL_STATE_RANK.UNKNOWN)
}

function isTextLike(part: UIMessagePart | undefined): part is TextLikePart {
  return part?.type === 'text' || part?.type === 'thinking'
}

/** The part of `parts` that is `part` by identity, or -1 (text, an unnamed thought). */
function identityIndex(parts: readonly UIMessagePart[], part: UIMessagePart) {
  return matchBy(part, 'type')
    .with('text', () => -1)
    .with('thinking', (value) =>
      value.stepId === undefined
        ? -1
        : parts.findIndex((other) => other.type === 'thinking' && other.stepId === value.stepId),
    )
    .with('tool-call', (value) =>
      parts.findIndex((other) => other.type === 'tool-call' && other.id === value.id),
    )
    .with('tool-result', (value) =>
      parts.findIndex(
        (other) => other.type === 'tool-result' && other.toolCallId === value.toolCallId,
      ),
    )
    .with('image', 'audio', 'video', 'document', (value) =>
      parts.findIndex(
        (other) =>
          other.type === value.type &&
          'source' in other &&
          other.source.value === value.source.value,
      ),
    )
    .exhaustive()
}

/** Two copies of one part: a tool call in its later state, a thought with the longer text. */
function mergeIdentical(existing: UIMessagePart, incoming: UIMessagePart): UIMessagePart {
  if (existing.type === 'tool-call' && incoming.type === 'tool-call') {
    return toolStateRank(incoming.state) >= toolStateRank(existing.state) ? incoming : existing
  }
  if (existing.type === 'thinking' && incoming.type === 'thinking') {
    const longer = incoming.content.includes(existing.content) ? incoming : existing
    return { ...longer, ...(incoming.stepId ? { stepId: incoming.stepId } : {}) }
  }
  return incoming
}

function replaceAt(parts: readonly UIMessagePart[], index: number, part: UIMessagePart) {
  return parts.map((existing, partIndex) => (partIndex === index ? part : existing))
}

/** `parts` with `part` merged into its identical copy, or, with `append`, added at the end. */
function withIdentical(parts: readonly UIMessagePart[], part: UIMessagePart, append: boolean) {
  const index = identityIndex(parts, part)
  const existing = parts[index]
  if (existing) return replaceAt(parts, index, mergeIdentical(existing, part))
  return append ? [...parts, part] : [...parts]
}

/** `parts` with a delta of `part` played on as the live view plays it. */
function withDelta(parts: readonly UIMessagePart[], part: TextLikePart, delta: string) {
  const index =
    part.type === 'thinking'
      ? identityIndex(parts, part)
      : parts.at(-1)?.type === 'text'
        ? parts.length - 1
        : -1
  const target = parts[index]
  if (isTextLike(target)) {
    return replaceAt(parts, index, { ...target, content: target.content + delta })
  }
  // A thought the buffer lacks is the shown one whole; text goes on after the buffer's last part.
  return [...parts, part.type === 'thinking' ? part : { ...part, content: delta }]
}

/** Whether each baseline part is still where it was in the shown parts, at most grown. */
function extendsBaseline(shown: readonly UIMessagePart[], baseline: readonly UIMessagePart[]) {
  return baseline.every((before, index) => {
    const now = shown[index]
    if (now?.type !== before.type) return false
    if (!isTextLike(before) || !isTextLike(now)) return true
    return now.content.startsWith(before.content)
  })
}

/** What streamed in after the read, played onto the buffer's parts. */
function withStreamedSince(
  bufferParts: readonly UIMessagePart[],
  shownParts: readonly UIMessagePart[],
  baseline: readonly UIMessagePart[],
) {
  return shownParts.reduce(
    (merged, part, index) => withShownPart(merged, part, baseline[index]),
    [...bufferParts],
  )
}

/**
 * One shown part played on: whole when it came after the read (`before` is none), its growth when
 * it is text that grew, and a tool call merged into its copy.
 */
function withShownPart(
  merged: readonly UIMessagePart[],
  part: UIMessagePart,
  before: UIMessagePart | undefined,
): UIMessagePart[] {
  // Shown only after the read: all of it streamed since, even into a part the buffer has.
  if (before === undefined) {
    return isTextLike(part)
      ? withDelta(merged, part, part.content)
      : withIdentical(merged, part, true)
  }
  if (!isTextLike(part) || !isTextLike(before)) return withIdentical(merged, part, false)
  const delta = part.content.slice(before.content.length)
  return delta ? withDelta(merged, part, delta) : [...merged]
}

/**
 * The merged parts of an answer. `streaming`: the answer the buffer streams. Without it the answer
 * finished before the read, and the buffer, which kept it whole, stands; a shown tool call it
 * lacks (a byte cap dropped it) is kept.
 */
export function mergeReconnectedAnswerParts(
  bufferParts: readonly UIMessagePart[],
  shownParts: readonly UIMessagePart[],
  streaming?: StreamingPartsBaseline,
): UIMessagePart[] {
  if (streaming?.degraded) {
    return bufferParts.reduce<UIMessagePart[]>(
      (merged, part) => withIdentical(merged, part, false),
      [...shownParts],
    )
  }
  if (streaming && extendsBaseline(shownParts, streaming.parts)) {
    return withStreamedSince(bufferParts, shownParts, streaming.parts)
  }
  return shownParts.reduce<UIMessagePart[]>(
    (merged, part) => (isTextLike(part) ? merged : withIdentical(merged, part, true)),
    [...bufferParts],
  )
}
