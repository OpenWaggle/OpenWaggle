import { open, stat } from 'node:fs/promises'
import type { PiSessionTitleSource } from '../../ports/pi-session-discovery'

/**
 * The start of a Pi session file as discovery reads it (ADR 0051): the header, the first user
 * message, the model it was sent with, and an early `/name`, from a bounded prefix. Pi records
 * the whole system prompt, with every tool schema, before the first user message (88–165 KB in
 * real sessions), so a file whose first 64 KiB hold no user message is read further, up to a
 * bound.
 */

/** How much of a new session file is read for its header, name, and first message. */
const DISCOVERY_PREFIX_BYTES = 64 * 1024
/** Pi's own bound for finding a header past blank or malformed lines (`readSessionHeader`). */
const MAX_HEADER_SCAN_BYTES = 1024 * 1024
/**
 * How far a file is read for its first user message when its prefix holds none. Pi records the
 * system prompt with every tool schema, MCP tools included, before it.
 */
const MAX_FIRST_MESSAGE_SCAN_BYTES = 4 * 1024 * 1024
/** Enough of the first message for a title, without remembering whole pasted prompts. */
const MAX_REMEMBERED_MESSAGE_LENGTH = 1024

function isRecord(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseLine(line: string): unknown {
  if (!line.trim()) return null
  try {
    return JSON.parse(line)
  } catch {
    // A line cut by the prefix bound, or one Pi itself would skip as malformed.
    return null
  }
}

/** The complete lines of the file's first `limit` bytes; a cut-off last line is dropped. */
async function readLines(file: string, limit: number) {
  const handle = await open(file, 'r')
  try {
    const buffer = Buffer.alloc(limit)
    const { bytesRead } = await handle.read(buffer, 0, limit, 0)
    const lines = buffer.subarray(0, bytesRead).toString('utf8').split('\n')
    if (bytesRead === limit) lines.pop()
    return { lines, complete: bytesRead < limit }
  } finally {
    await handle.close()
  }
}

type HeaderSearch =
  | {
      readonly kind: 'header'
      readonly header: { readonly [key: string]: unknown }
      readonly index: number
    }
  | { readonly kind: 'not-a-session' }
  | { readonly kind: 'not-found' }

/**
 * Mirrors Pi's `readSessionHeader`: blank and malformed lines are skipped, and the first entry
 * that parses decides. A session header makes the file a session; anything else means it is not.
 */
function findHeader(lines: readonly string[]): HeaderSearch {
  for (const [index, line] of lines.entries()) {
    const entry = parseLine(line)
    if (entry === null) continue
    if (isRecord(entry) && entry.type === 'session' && typeof entry.id === 'string') {
      return { kind: 'header', header: entry, index }
    }
    return { kind: 'not-a-session' }
  }
  return { kind: 'not-found' }
}

function isUserMessage(entry: { readonly [key: string]: unknown }) {
  return entry.type === 'message' && isRecord(entry.message) && entry.message.role === 'user'
}

/** When the user message was sent: Pi's message time, else the entry's. */
function messageTime(entry: { readonly [key: string]: unknown }) {
  const message = isRecord(entry.message) ? entry.message : undefined
  if (typeof message?.timestamp === 'number' && Number.isFinite(message.timestamp)) {
    return message.timestamp
  }
  const parsed = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : Number.NaN
  return Number.isFinite(parsed) ? parsed : null
}

function modelChange(entry: { readonly [key: string]: unknown }) {
  if (entry.type !== 'model_change') return null
  const { provider, modelId } = entry
  return typeof provider === 'string' && provider && typeof modelId === 'string' && modelId
    ? `${provider}/${modelId}`
    : null
}

function userMessageText(entry: { readonly [key: string]: unknown }) {
  if (entry.type !== 'message' || !isRecord(entry.message)) return null
  const message = entry.message
  if (message.role !== 'user') return null
  if (typeof message.content === 'string') return message.content.trim() || null
  if (!Array.isArray(message.content)) return null
  const text = message.content
    .flatMap((part: unknown) =>
      isRecord(part) && part.type === 'text' && typeof part.text === 'string' ? [part.text] : [],
    )
    .join(' ')
    .trim()
  return text || null
}

interface PiSessionPrefix extends PiSessionTitleSource {
  readonly id: string
  readonly cwd: string
  readonly timestamp: string | null
}

interface PrefixEntries {
  readonly name: string | null
  readonly firstUserMessage: string | null
  readonly firstUserMessageAt: number | null
  /** The latest model change seen before the first user message. */
  readonly model: string | null
}

function sessionName(entry: { readonly [key: string]: unknown }) {
  return typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : null
}

function readEntry(read: PrefixEntries, entry: { readonly [key: string]: unknown }): PrefixEntries {
  const named = entry.type === 'session_info' ? { ...read, name: sessionName(entry) } : read
  if (named.firstUserMessage !== null) return named
  // The model the session had when its first message was sent, which titles it.
  const withModel = { ...named, model: modelChange(entry) ?? named.model }
  const text = isUserMessage(entry) ? userMessageText(entry) : null
  if (text === null) return withModel
  return { ...withModel, firstUserMessage: text, firstUserMessageAt: messageTime(entry) }
}

function parsePrefix(lines: readonly string[]): PiSessionPrefix | null {
  const search = findHeader(lines)
  if (search.kind !== 'header') return null
  const header = search.header
  if (typeof header.id !== 'string' || !header.id) return null
  if (typeof header.cwd !== 'string' || !header.cwd) return null
  let read: PrefixEntries = {
    name: null,
    firstUserMessage: null,
    firstUserMessageAt: null,
    model: null,
  }
  for (const line of lines.slice(search.index + 1)) {
    const entry = parseLine(line)
    if (isRecord(entry)) read = readEntry(read, entry)
  }
  return {
    id: header.id,
    cwd: header.cwd,
    timestamp: typeof header.timestamp === 'string' ? header.timestamp : null,
    ...read,
    model: read.firstUserMessage === null ? null : read.model,
  }
}

/** The file's leading lines: 64 KiB, or up to Pi's 1 MiB header bound when no entry parsed. */
async function readLeadingLines(file: string) {
  const prefix = await readLines(file, DISCOVERY_PREFIX_BYTES)
  if (prefix.complete || findHeader(prefix.lines).kind !== 'not-found') return prefix
  return readLines(file, MAX_HEADER_SCAN_BYTES)
}

/**
 * The file's start as discovery reads it: further than the prefix when the prefix ends before
 * the first user message, which Pi's recorded system prompt pushes past 64 KiB.
 */
async function readPrefix(file: string) {
  const leading = await readLeadingLines(file)
  const parsed = parsePrefix(leading.lines)
  if (!parsed || parsed.firstUserMessage !== null || leading.complete) return parsed
  return parsePrefix((await readLines(file, MAX_FIRST_MESSAGE_SCAN_BYTES)).lines)
}

export interface PiSessionFileHeader extends PiSessionPrefix {
  readonly createdAt: number
}

/** Null when the file is not a Pi session, or has no header yet (it may still be being written). */
export async function readPiSessionFileHeader(file: string): Promise<PiSessionFileHeader | null> {
  try {
    const [parsed, stats] = await Promise.all([readPrefix(file), stat(file)])
    if (!parsed) return null
    const createdAt = parsed.timestamp ? Date.parse(parsed.timestamp) : Number.NaN
    return {
      ...parsed,
      firstUserMessage: parsed.firstUserMessage?.slice(0, MAX_REMEMBERED_MESSAGE_LENGTH) ?? null,
      createdAt: Number.isFinite(createdAt) ? createdAt : stats.birthtimeMs,
    }
  } catch {
    // Discovery is best effort: a file removed or unreadable mid-scan is simply not listed.
    return null
  }
}
