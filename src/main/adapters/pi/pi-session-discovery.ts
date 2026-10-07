import { open, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { getAgentDir } from '@earendil-works/pi-coding-agent'
import type { DiscoveredPiSession, PiSessionDiscoveryInput } from '../../ports/pi-session-discovery'

/**
 * Pi session discovery (ADR 0048): finds Pi sessions the `pi` CLI created inside an OpenWaggle
 * project without loading their transcripts.
 *
 * Pi keeps one directory per working directory under `<agent dir>/sessions`, named from the path
 * (`/a/b` becomes `--a-b--`). A project's sessions, and those of every folder inside it, live in
 * the directories whose name starts with the project's encoding. The encoding is ambiguous
 * (`/a/b-c` and `/a/b/c` encode alike), so a candidate is confirmed from the `cwd` in its header.
 * Only a bounded prefix of each new file is read: the header, the first user message, and an early
 * `/name`. Pi's own `SessionManager.list` streams every file in full, which is too slow to repeat
 * across thousands of sessions.
 */

/** How much of a new session file is read for its header, name, and first message. */
const DISCOVERY_PREFIX_BYTES = 64 * 1024
/** Pi's own bound for finding a header past blank or malformed lines (`readSessionHeader`). */
const MAX_HEADER_SCAN_BYTES = 1024 * 1024
const PI_SESSION_FILE_SUFFIX = '.jsonl'
/** Enough of the first message for a title, without remembering whole pasted prompts. */
const MAX_REMEMBERED_MESSAGE_LENGTH = 1024

export interface PiSessionDiscoveryScanner {
  readonly scan: (input: PiSessionDiscoveryInput) => Promise<readonly DiscoveredPiSession[]>
}

/** Pi's directory-name encoding of a working directory, without the closing `--`. */
function encodedPathPrefix(directory: string) {
  return `--${path
    .resolve(directory)
    .replace(/^[/\\]/, '')
    .replace(/[/\\:]/g, '-')}`
}

function sessionDirectoryMayBelongTo(directoryName: string, projectPrefix: string) {
  return directoryName === `${projectPrefix}--` || directoryName.startsWith(`${projectPrefix}-`)
}

function isPathInsideProject(candidate: string, projectPath: string) {
  const relative = path.relative(path.resolve(projectPath), path.resolve(candidate))
  if (path.isAbsolute(relative)) return false
  return relative !== '..' && !relative.startsWith(`..${path.sep}`)
}

function owningProject(cwd: string, projectPaths: readonly string[]) {
  let owner: string | null = null
  for (const projectPath of projectPaths) {
    if (!isPathInsideProject(cwd, projectPath)) continue
    if (owner === null || projectPath.length > owner.length) owner = projectPath
  }
  return owner
}

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

interface PiSessionPrefix {
  readonly id: string
  readonly cwd: string
  readonly timestamp: string | null
  readonly name: string | null
  readonly firstUserMessage: string | null
}

function parsePrefix(lines: readonly string[]): PiSessionPrefix | null {
  const search = findHeader(lines)
  if (search.kind !== 'header') return null
  const header = search.header
  if (typeof header.id !== 'string' || !header.id) return null
  if (typeof header.cwd !== 'string' || !header.cwd) return null
  let name: string | null = null
  let firstUserMessage: string | null = null
  for (const line of lines.slice(search.index + 1)) {
    const entry = parseLine(line)
    if (!isRecord(entry)) continue
    if (entry.type === 'session_info') {
      name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : null
    }
    firstUserMessage ??= userMessageText(entry)
  }
  return {
    id: header.id,
    cwd: header.cwd,
    timestamp: typeof header.timestamp === 'string' ? header.timestamp : null,
    name,
    firstUserMessage,
  }
}

/** The file's leading lines: 64 KiB, or up to Pi's 1 MiB header bound when no entry parsed. */
async function readLeadingLines(file: string) {
  const prefix = await readLines(file, DISCOVERY_PREFIX_BYTES)
  if (prefix.complete || findHeader(prefix.lines).kind !== 'not-found') return prefix.lines
  return (await readLines(file, MAX_HEADER_SCAN_BYTES)).lines
}

interface PiSessionFileHeader extends PiSessionPrefix {
  readonly createdAt: number
}

/** Null when the file is not a Pi session, or has no header yet (it may still be being written). */
async function readHeader(file: string): Promise<PiSessionFileHeader | null> {
  try {
    const [lines, stats] = await Promise.all([readLeadingLines(file), stat(file)])
    const parsed = parsePrefix(lines)
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

async function fileState(file: string) {
  try {
    const stats = await stat(file)
    return { size: stats.size, mtimeMs: stats.mtimeMs }
  } catch {
    return null
  }
}

async function readDirectoryNames(directory: string) {
  try {
    return await readdir(directory)
  } catch {
    return []
  }
}

/**
 * A file's header never changes, so the scanner reads each file once and remembers it, and a file
 * without one is read again only after it changes. A file of
 * a sibling directory that shares the project's prefix, or of a session OpenWaggle lists under
 * another path, is then never read again; a project added later is matched against what is
 * already known.
 */
export function createPiSessionDiscoveryScanner(
  options: { readonly sessionsRoot?: string } = {},
): PiSessionDiscoveryScanner {
  const headers = new Map<string, PiSessionFileHeader>()
  /** Files without a Pi header, by the version read: read again only once they change. */
  const headerless = new Map<string, { readonly size: number; readonly mtimeMs: number }>()

  const headerOf = async (
    file: string,
    state: { readonly size: number; readonly mtimeMs: number },
  ) => {
    const remembered = headers.get(file)
    if (remembered) return remembered
    const skipped = headerless.get(file)
    if (skipped?.size === state.size && skipped.mtimeMs === state.mtimeMs) return null
    const header = await readHeader(file)
    if (header) {
      headers.set(file, header)
      headerless.delete(file)
    } else {
      headerless.set(file, state)
    }
    return header
  }

  const discoveredSession = async (
    file: string,
    projectPaths: readonly string[],
  ): Promise<DiscoveredPiSession | null> => {
    const state = await fileState(file)
    if (state === null) return null
    const header = await headerOf(file, state)
    const projectPath = header ? owningProject(header.cwd, projectPaths) : null
    if (!header || !projectPath) return null
    return {
      piSessionId: header.id,
      piSessionFile: file,
      cwd: header.cwd,
      projectPath,
      name: header.name,
      firstUserMessage: header.firstUserMessage,
      createdAt: header.createdAt,
      updatedAt: state.mtimeMs,
      size: state.size,
    }
  }

  return {
    scan: async ({ projectPaths, isKnownFile }) => {
      if (projectPaths.length === 0) return []
      const sessionsRoot = options.sessionsRoot ?? path.join(getAgentDir(), 'sessions')
      const prefixes = projectPaths.map(encodedPathPrefix)
      const directories = (await readDirectoryNames(sessionsRoot)).filter((name) =>
        prefixes.some((prefix) => sessionDirectoryMayBelongTo(name, prefix)),
      )
      const discovered: DiscoveredPiSession[] = []
      for (const directory of directories) {
        const directoryPath = path.join(sessionsRoot, directory)
        for (const name of await readDirectoryNames(directoryPath)) {
          if (!name.endsWith(PI_SESSION_FILE_SUFFIX)) continue
          const file = path.join(directoryPath, name)
          if (isKnownFile(file)) continue
          const session = await discoveredSession(file, projectPaths)
          if (session) discovered.push(session)
        }
      }
      return discovered
    },
  }
}
