import { open, stat } from 'node:fs/promises'
import type { PiSessionTitleSource } from '../../ports/pi-session-discovery'
import {
  type PiSessionEntry,
  parsePiSessionEntryLine,
  parsePiSessionObjectLine,
  piUserMessageText,
} from './pi-session-jsonl-entry'

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
      readonly header: PiSessionEntry
      readonly index: number
    }
  | { readonly kind: 'not-a-session' }
  | { readonly kind: 'not-found' }

/**
 * Mirrors Pi's `readSessionHeader`: blank and malformed lines are skipped, and the first entry
 * that parses decides. A session header makes the file a session; anything else means it is not.
 */
function findHeader(lines: readonly string[]) {
  for (const [index, line] of lines.entries()) {
    const entry = parsePiSessionEntryLine(line)
    if (entry === null) continue
    if (entry.type === 'session' && entry.id !== undefined) {
      const search: HeaderSearch = { kind: 'header', header: entry, index }
      return search
    }
    const search: HeaderSearch = { kind: 'not-a-session' }
    return search
  }
  const search: HeaderSearch = { kind: 'not-found' }
  return search
}

/** When the user message was sent: Pi's message time, else the entry's. */
function messageTime(entry: PiSessionEntry) {
  if (entry.message?.timestamp !== undefined) return entry.message.timestamp
  const parsed = entry.timestamp === undefined ? Number.NaN : Date.parse(entry.timestamp)
  return Number.isFinite(parsed) ? parsed : null
}

function modelChange(entry: PiSessionEntry) {
  if (entry.type !== 'model_change') return null
  const { provider, modelId } = entry
  return provider && modelId ? `${provider}/${modelId}` : null
}

function userMessageText(entry: PiSessionEntry) {
  if (entry.type !== 'message' || entry.message === undefined) return null
  return piUserMessageText(entry.message)?.trim() || null
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

function sessionName(entry: PiSessionEntry) {
  return entry.name?.trim() || null
}

function readEntry(read: PrefixEntries, entry: PiSessionEntry) {
  const named = entry.type === 'session_info' ? { ...read, name: sessionName(entry) } : read
  if (named.firstUserMessage !== null) return named
  // The model the session had when its first message was sent, which titles it.
  const withModel = { ...named, model: modelChange(entry) ?? named.model }
  const text = userMessageText(entry)
  if (text === null) {
    const entries: PrefixEntries = withModel
    return entries
  }
  const entries: PrefixEntries = {
    ...withModel,
    firstUserMessage: text,
    firstUserMessageAt: messageTime(entry),
  }
  return entries
}

function parsePrefix(lines: readonly string[]) {
  const search = findHeader(lines)
  if (search.kind !== 'header') return null
  const header = search.header
  const { id, cwd } = header
  if (!id || !cwd) return null
  let read: PrefixEntries = {
    name: null,
    firstUserMessage: null,
    firstUserMessageAt: null,
    model: null,
  }
  for (const line of lines.slice(search.index + 1)) {
    const entry = parsePiSessionObjectLine(line)
    if (entry !== null) read = readEntry(read, entry)
  }
  const prefix: PiSessionPrefix | null = {
    id,
    cwd,
    timestamp: header.timestamp ?? null,
    ...read,
    model: read.firstUserMessage === null ? null : read.model,
  }
  return prefix
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
  if (parsed?.firstUserMessage !== null || leading.complete) return parsed
  return parsePrefix((await readLines(file, MAX_FIRST_MESSAGE_SCAN_BYTES)).lines)
}

export interface PiSessionFileHeader extends PiSessionPrefix {
  readonly createdAt: number
}

/** Null when the file is not a Pi session, or has no header yet (it may still be being written). */
export async function readPiSessionFileHeader(file: string) {
  try {
    const [parsed, stats] = await Promise.all([readPrefix(file), stat(file)])
    if (!parsed) return null
    const createdAt = parsed.timestamp ? Date.parse(parsed.timestamp) : Number.NaN
    const header: PiSessionFileHeader | null = {
      ...parsed,
      firstUserMessage: parsed.firstUserMessage?.slice(0, MAX_REMEMBERED_MESSAGE_LENGTH) ?? null,
      createdAt: Number.isFinite(createdAt) ? createdAt : stats.birthtimeMs,
    }
    return header
  } catch {
    // Discovery is best effort: a file removed or unreadable mid-scan is simply not listed.
    return null
  }
}
