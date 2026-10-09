import { createHash } from 'node:crypto'
import type { ContextEvent, SessionEntry } from '@earendil-works/pi-coding-agent'
import {
  PI_WAGGLE_TURN_CUSTOM_TYPE,
  PI_WAGGLE_USER_REQUEST_CUSTOM_TYPE,
} from '@openwaggle/pi-waggle/protocol'
import { OPENWAGGLE_RUN_IDENTITY_CUSTOM_TYPE } from '@shared/constants/run-identity'
import { isRecord } from '@shared/utils/validation'

type ContextMessage = ContextEvent['messages'][number]
type CustomMessage = Extract<ContextMessage, { role: 'custom' }>
type PromptMessage = Extract<ContextMessage, { role: 'user' | 'custom' }>

/** The custom messages a Waggle Run is prompted with (`waggle-run-messages.ts`). */
const WAGGLE_PROMPT_CUSTOM_TYPES = new Set([
  PI_WAGGLE_USER_REQUEST_CUSTOM_TYPE,
  PI_WAGGLE_TURN_CUSTOM_TYPE,
])

/** A Run's prompt: a user message, or the custom message that starts a Waggle Run. */
function isPromptMessage(message: ContextMessage): message is PromptMessage {
  if (message.role === 'user') return true
  return message.role === 'custom' && WAGGLE_PROMPT_CUSTOM_TYPES.has(message.customType)
}

const RUN_IDENTITY_DETAILS = { source: 'openwaggle', kind: 'run-identity' } as const

/**
 * A Run identity and the prompt it follows. The prompt is named by its timestamp and a digest of
 * its content, not by entry order or time: Pi's entries, prompts, and identities can share one
 * millisecond, and a request is built from copies of the messages.
 */
export interface RunIdentityEntryData {
  readonly content: string
  readonly prompt: { readonly timestamp: number; readonly digest: string }
}

function promptDigest(message: PromptMessage) {
  return createHash('sha256').update(JSON.stringify(message.content)).digest('hex')
}

function isPrompt(message: ContextMessage, prompt: RunIdentityEntryData['prompt']) {
  return (
    isPromptMessage(message) &&
    message.timestamp === prompt.timestamp &&
    promptDigest(message) === prompt.digest
  )
}

/** The entry for a Run's identity, placed after its prompt: the latest prompt message. */
export function runIdentityEntryData(
  content: string,
  messages: readonly ContextMessage[],
): RunIdentityEntryData | undefined {
  const prompt = messages.findLast(isPromptMessage)
  if (!prompt) return undefined
  return { content, prompt: { timestamp: prompt.timestamp, digest: promptDigest(prompt) } }
}

function storedRunIdentity(entry: SessionEntry): RunIdentityEntryData | undefined {
  if (entry.type !== 'custom' || entry.customType !== OPENWAGGLE_RUN_IDENTITY_CUSTOM_TYPE) {
    return undefined
  }
  const data: unknown = entry.data
  if (!isRecord(data) || typeof data.content !== 'string' || !isRecord(data.prompt)) {
    return undefined
  }
  const { timestamp, digest } = data.prompt
  if (typeof timestamp !== 'number' || typeof digest !== 'string') return undefined
  return { content: data.content, prompt: { timestamp, digest } }
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

/**
 * The model's messages with each stored Run identity right after its Run's prompt. That is where
 * Pi put the context message it used to be, so an earlier Run's request stays a prefix of the
 * next one and keeps its prompt cache. A Run whose prompt was compacted away sends no identity.
 */
export function withRunIdentities(
  messages: readonly ContextMessage[],
  branch: readonly SessionEntry[],
) {
  const identities = branch.flatMap((entry) => storedRunIdentity(entry) ?? [])
  if (identities.length === 0) return undefined
  const placed = new Map<number, CustomMessage[]>()
  for (const identity of identities) {
    const prompt = messages.findIndex((message) => isPrompt(message, identity.prompt))
    if (prompt < 0) continue
    placed.set(prompt, [...(placed.get(prompt) ?? []), runIdentityMessage(identity)])
  }
  if (placed.size === 0) return undefined
  return messages.flatMap((message, index) => [message, ...(placed.get(index) ?? [])])
}
