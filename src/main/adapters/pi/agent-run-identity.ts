import { createHash } from 'node:crypto'
import type { ContextEvent, SessionEntry } from '@earendil-works/pi-coding-agent'
import { PI_WAGGLE_USER_REQUEST_CUSTOM_TYPE } from '@openwaggle/pi-waggle/protocol'
import { OPENWAGGLE_RUN_IDENTITY_CUSTOM_TYPE } from '@shared/constants/run-identity'
import { isRecord } from '@shared/utils/validation'

type ContextMessage = ContextEvent['messages'][number]
type CustomMessage = Extract<ContextMessage, { role: 'custom' }>
type PromptMessage = Extract<ContextMessage, { role: 'user' | 'custom' }>

/**
 * A Run's start message: a user message, or the user request a Waggle Run starts with
 * (`waggle-run-messages.ts`). A Waggle turn message is not one: every turn adds another.
 */
function isPromptMessage(message: ContextMessage): message is PromptMessage {
  if (message.role === 'user') return true
  return message.role === 'custom' && message.customType === PI_WAGGLE_USER_REQUEST_CUSTOM_TYPE
}

/** A message an identity can follow: any user or custom message but a Run identity itself. */
function isAnchorMessage(message: ContextMessage): message is PromptMessage {
  if (message.role === 'user') return true
  return message.role === 'custom' && message.customType !== OPENWAGGLE_RUN_IDENTITY_CUSTOM_TYPE
}

const RUN_IDENTITY_DETAILS = { source: 'openwaggle', kind: 'run-identity' } as const

/**
 * A Run identity and the message that started its Run. That message is named by a digest of its
 * content, not by entry order or time: Pi's entries, prompts, and identities can share one
 * millisecond, and a request is built from copies of the messages. A user message also keeps
 * its timestamp, which Pi stores with it. A custom message is named by its custom type instead:
 * reloaded from the file it carries its entry's time, not the time it was sent.
 */
export interface RunIdentityEntryData {
  readonly content: string
  readonly prompt: {
    readonly timestamp: number
    readonly digest: string
    readonly customType?: string
  }
}

function promptDigest(message: PromptMessage) {
  return createHash('sha256').update(JSON.stringify(message.content)).digest('hex')
}

function isPrompt(message: ContextMessage, prompt: RunIdentityEntryData['prompt']) {
  if (!isAnchorMessage(message)) return false
  const sameMessage =
    prompt.customType === undefined
      ? message.timestamp === prompt.timestamp
      : message.role === 'custom' && message.customType === prompt.customType
  return sameMessage && promptDigest(message) === prompt.digest
}

/**
 * The entry for a Run's identity, placed after the message that started the Run: its prompt
 * after the last answer, or else the first message after it, such as the custom message an
 * extension command starts a turn with (`pi.sendMessage(..., { triggerTurn: true })`). Never an
 * earlier Run's prompt, whose request would then change.
 */
export function runIdentityEntryData(
  content: string,
  messages: readonly ContextMessage[],
): RunIdentityEntryData | undefined {
  const turn = messages.slice(messages.findLastIndex((message) => message.role === 'assistant') + 1)
  const prompt = turn.findLast(isPromptMessage) ?? turn.find(isAnchorMessage)
  if (!prompt) return undefined
  const digest = promptDigest(prompt)
  return {
    content,
    prompt:
      prompt.role === 'custom'
        ? { timestamp: prompt.timestamp, digest, customType: prompt.customType }
        : { timestamp: prompt.timestamp, digest },
  }
}

function storedRunIdentity(entry: SessionEntry): RunIdentityEntryData | undefined {
  if (entry.type !== 'custom' || entry.customType !== OPENWAGGLE_RUN_IDENTITY_CUSTOM_TYPE) {
    return undefined
  }
  const data: unknown = entry.data
  if (!isRecord(data) || typeof data.content !== 'string' || !isRecord(data.prompt)) {
    return undefined
  }
  const { timestamp, digest, customType } = data.prompt
  if (typeof timestamp !== 'number' || typeof digest !== 'string') return undefined
  if (customType !== undefined && typeof customType !== 'string') return undefined
  return {
    content: data.content,
    prompt: customType === undefined ? { timestamp, digest } : { timestamp, digest, customType },
  }
}

function runIdentityContent(entry: SessionEntry) {
  // Runs before the Run identity became a plain entry stored it as a context message.
  if (entry.type === 'custom_message' && entry.customType === OPENWAGGLE_RUN_IDENTITY_CUSTOM_TYPE) {
    return typeof entry.content === 'string' ? entry.content : undefined
  }
  return storedRunIdentity(entry)?.content
}

/** The latest Run identity on the branch, so a Run stores its own only when it differs. */
export function latestRunIdentityContent(branch: readonly SessionEntry[]) {
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index]
    const content = entry ? runIdentityContent(entry) : undefined
    if (content !== undefined) return content
  }
  return undefined
}

function runIdentityMessage(identity: RunIdentityEntryData): CustomMessage {
  return {
    role: 'custom',
    customType: OPENWAGGLE_RUN_IDENTITY_CUSTOM_TYPE,
    content: identity.content,
    display: false,
    details: RUN_IDENTITY_DETAILS,
    timestamp: identity.prompt.timestamp,
  }
}

/** The message a branch entry gives the model, when it is one an identity can follow. */
function entryMessage(entry: SessionEntry): ContextMessage | undefined {
  if (entry.type === 'message') return entry.message
  if (entry.type !== 'custom_message') return undefined
  // Only the custom type and content name a custom prompt (see `isPrompt`).
  return {
    role: 'custom',
    customType: entry.customType,
    content: entry.content,
    display: entry.display,
    timestamp: 0,
  }
}

/**
 * Each stored Run identity with how many later branch entries sent the same prompt again. The
 * identity's prompt is that many matching messages before the last one.
 */
function identitiesWithLaterPrompts(branch: readonly SessionEntry[]) {
  const identities: { identity: RunIdentityEntryData; laterPrompts: number }[] = []
  for (const entry of branch) {
    const identity = storedRunIdentity(entry)
    if (identity) {
      identities.push({ identity, laterPrompts: 0 })
      continue
    }
    const message = entryMessage(entry)
    if (!message) continue
    for (const stored of identities) {
      if (isPrompt(message, stored.identity.prompt)) stored.laterPrompts += 1
    }
  }
  return identities
}

/**
 * The model's messages with each stored Run identity right after its Run's prompt. That is where
 * Pi put the context message it used to be, so an earlier Run's request stays a prefix of the
 * next one and keeps its prompt cache. The prompt is found by branch order: a Run's identity
 * follows its prompt's entry, so the prompts with the same content sent after it (by a later
 * Run, with or without an identity, such as a pi CLI turn) say which matching message is its.
 * Compaction removes the oldest messages first, so counting from the last match still holds; an
 * identity whose prompt was compacted away is dropped instead of taking a later Run's.
 */
export function withRunIdentities(
  messages: readonly ContextMessage[],
  branch: readonly SessionEntry[],
) {
  const identities = identitiesWithLaterPrompts(branch)
  if (identities.length === 0) return undefined
  const placed = new Map<number, CustomMessage[]>()
  for (const { identity, laterPrompts } of identities) {
    const matches = messages.flatMap((message, index) =>
      isPrompt(message, identity.prompt) ? [index] : [],
    )
    const prompt = matches[matches.length - 1 - laterPrompts]
    if (prompt === undefined) continue
    placed.set(prompt, [...(placed.get(prompt) ?? []), runIdentityMessage(identity)])
  }
  if (placed.size === 0) return undefined
  return messages.flatMap((message, index) => [message, ...(placed.get(index) ?? [])])
}
