import { open, stat } from 'node:fs/promises'
import type { PiSessionPromptOrigin } from '../../ports/pi-session-discovery'
import { OPENWAGGLE_USER_INPUT_CUSTOM_TYPE } from './agent-kernel/user-input-projection'
import {
  type PiSessionEntry,
  type PiSessionMessage,
  parsePiSessionObjectLine,
} from './pi-session-jsonl-entry'
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

function leavesTurnRunning(message: PiSessionMessage) {
  if (message.role === 'toolResult') return true
  return message.role === 'assistant' && message.stopReason === 'toolUse'
}

function nextScan(scan: OriginScan, entry: PiSessionEntry) {
  if (entry.type === 'custom') {
    if (entry.customType === OPENWAGGLE_RUN_BOUNDARY_CUSTOM_TYPE) {
      const result: OriginScan = {
        origin: 'openwaggle',
        afterOpenWaggleInput: false,
        turnRunning: false,
      }
      return result
    }
    if (entry.customType === OPENWAGGLE_USER_INPUT_CUSTOM_TYPE) {
      const result: OriginScan = { ...scan, afterOpenWaggleInput: true }
      return result
    }
    const result: OriginScan = { ...scan, afterOpenWaggleInput: false }
    return result
  }
  const { message } = entry
  if (entry.type !== 'message' || message === undefined) {
    const result: OriginScan = { ...scan, afterOpenWaggleInput: false }
    return result
  }
  if (message.role !== 'user') {
    const result: OriginScan = {
      ...scan,
      afterOpenWaggleInput: false,
      turnRunning: leavesTurnRunning(message),
    }
    return result
  }
  const origin = scan.afterOpenWaggleInput
    ? 'openwaggle'
    : scan.turnRunning
      ? (scan.origin ?? 'outside')
      : 'outside'
  const result: OriginScan = { origin, afterOpenWaggleInput: false, turnRunning: false }
  return result
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
    const entry = parsePiSessionObjectLine(line)
    if (entry !== null) current = nextScan(current, entry)
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
  const lastPromptOrigin = async (file: string) => {
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
