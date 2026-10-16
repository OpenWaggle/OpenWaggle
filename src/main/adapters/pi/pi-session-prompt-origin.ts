import { open, stat } from 'node:fs/promises'
import type { PiSessionPromptOrigin } from '../../ports/pi-session-discovery'
import { OPENWAGGLE_USER_INPUT_CUSTOM_TYPE } from './agent-kernel/user-input-projection'
import { OPENWAGGLE_RUN_BOUNDARY_CUSTOM_TYPE } from './run-attribution-extension'

/**
 * Who wrote a Pi session file's latest prompt: an OpenWaggle Run or something else, such as the
 * `pi` CLI (ADR 0051). Pi files are append-only, so each file is read once and then only from
 * where the last read stopped.
 *
 * An OpenWaggle Run starts with an `openwaggle-run-boundary` entry and records each user message
 * it sends with an `openwaggle-user-input` entry right before it. A user message without one is a
 * prompt from outside, unless it was steered into a turn still running (it follows a tool result
 * or a reply that called a tool), which keeps the turn's origin. A pi CLI turn started by an
 * extension message has no user message and changes nothing.
 */

interface OriginScan {
  readonly origin: PiSessionPromptOrigin | null
  /** The previous entry was OpenWaggle's record of the user message that follows it. */
  readonly afterOpenWaggleInput: boolean
  /** The latest message left its turn running: a tool result, or a reply that called a tool. */
  readonly turnRunning: boolean
}

interface ScannedFile {
  readonly size: number
  readonly mtimeMs: number
  /** Bytes read, up to the end of the last complete line. */
  readonly offset: number
  readonly scan: OriginScan
}

const INITIAL_SCAN: OriginScan = { origin: null, afterOpenWaggleInput: false, turnRunning: false }
const NEWLINE = 0x0a
/** Files remembered; the least recently read is forgotten first. */
const MAX_REMEMBERED_FILES = 256

function isRecord(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseLine(line: string): unknown {
  if (!line.trim()) return null
  try {
    return JSON.parse(line)
  } catch {
    // A malformed line, which Pi itself skips.
    return null
  }
}

function leavesTurnRunning(message: { readonly [key: string]: unknown }) {
  if (message.role === 'toolResult') return true
  return message.role === 'assistant' && message.stopReason === 'toolUse'
}

function nextScan(scan: OriginScan, entry: { readonly [key: string]: unknown }): OriginScan {
  if (entry.type === 'custom') {
    if (entry.customType === OPENWAGGLE_RUN_BOUNDARY_CUSTOM_TYPE) {
      return { origin: 'openwaggle', afterOpenWaggleInput: false, turnRunning: false }
    }
    if (entry.customType === OPENWAGGLE_USER_INPUT_CUSTOM_TYPE) {
      return { ...scan, afterOpenWaggleInput: true }
    }
    return { ...scan, afterOpenWaggleInput: false }
  }
  if (entry.type !== 'message' || !isRecord(entry.message)) {
    return { ...scan, afterOpenWaggleInput: false }
  }
  const message = entry.message
  if (message.role !== 'user') {
    return { ...scan, afterOpenWaggleInput: false, turnRunning: leavesTurnRunning(message) }
  }
  const origin = scan.afterOpenWaggleInput
    ? 'openwaggle'
    : scan.turnRunning
      ? (scan.origin ?? 'outside')
      : 'outside'
  return { origin, afterOpenWaggleInput: false, turnRunning: false }
}

async function readFrom(file: string, offset: number, size: number) {
  const handle = await open(file, 'r')
  try {
    const buffer = Buffer.alloc(Math.max(0, size - offset))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

function scanBytes(scan: OriginScan, bytes: Buffer) {
  // A last line without its newline may still be being written; it is read next time.
  const end = bytes.lastIndexOf(NEWLINE) + 1
  let current = scan
  for (const line of bytes.subarray(0, end).toString('utf8').split('\n')) {
    const entry = parseLine(line)
    if (isRecord(entry)) current = nextScan(current, entry)
  }
  return { scan: current, consumed: end }
}

export function createPiSessionPromptOrigins() {
  const files = new Map<string, ScannedFile>()

  const remember = (file: string, scanned: ScannedFile) => {
    files.delete(file)
    files.set(file, scanned)
    if (files.size <= MAX_REMEMBERED_FILES) return
    const oldest = files.keys().next().value
    if (oldest !== undefined) files.delete(oldest)
  }

  /** Null when the file is missing or has no prompt yet. */
  const lastPromptOrigin = async (file: string): Promise<PiSessionPromptOrigin | null> => {
    let stats: { readonly size: number; readonly mtimeMs: number }
    try {
      stats = await stat(file)
    } catch {
      return null
    }
    const known = files.get(file)
    if (known?.size === stats.size && known.mtimeMs === stats.mtimeMs) return known.scan.origin
    // A file that shrank was rewritten, as when `pi --resume` upgrades an older format.
    const resume = known && known.size <= stats.size ? known : undefined
    const offset = resume?.offset ?? 0
    try {
      const bytes = await readFrom(file, offset, stats.size)
      const { scan, consumed } = scanBytes(resume?.scan ?? INITIAL_SCAN, bytes)
      remember(file, { size: stats.size, mtimeMs: stats.mtimeMs, offset: offset + consumed, scan })
      return scan.origin
    } catch {
      return null
    }
  }

  return { lastPromptOrigin }
}
