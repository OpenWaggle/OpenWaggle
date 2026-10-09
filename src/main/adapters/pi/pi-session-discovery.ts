import { open, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { getAgentDir } from '@earendil-works/pi-coding-agent'
import type { DiscoveredPiSession, PiSessionDiscoveryInput } from '../../ports/pi-session-discovery'
import { resolvePiSessionDirectory } from './pi-session-directory'
import {
  encodedPathPrefix,
  owningProject,
  type ProjectLocation,
  projectLocations,
  sessionDirectoryMayBelongTo,
} from './pi-session-project-paths'

/**
 * Pi session discovery (ADR 0050): finds Pi sessions the `pi` CLI created inside an OpenWaggle
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

interface FileVersion {
  readonly size: number
  readonly mtimeMs: number
}

async function fileState(file: string): Promise<FileVersion | null> {
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
 * The scanner remembers what it read from each file by the version it read, and reads a file
 * again only once it changes: its header never changes, but a later `/name` does. A file of a
 * sibling directory that shares the project's prefix, or of a session OpenWaggle lists under
 * another path, is then not read again until it changes; a project added later is matched against
 * what is already known. A file no scan lists any more is forgotten.
 */
export function createPiSessionDiscoveryScanner(
  options: {
    readonly sessionsRoot?: string
    readonly resolveSessionDirectory?: (projectPath: string) => string | undefined
  } = {},
): PiSessionDiscoveryScanner {
  /** What each file's start held, or null for a file without a Pi header, by the version read. */
  const headers = new Map<string, FileVersion & { readonly header: PiSessionFileHeader | null }>()

  const headerOf = async (file: string, state: FileVersion) => {
    const remembered = headers.get(file)
    if (remembered?.size === state.size && remembered.mtimeMs === state.mtimeMs) {
      return remembered.header
    }
    const header = await readHeader(file)
    headers.set(file, { ...state, header })
    return header
  }

  const discoveredSession = async (
    file: string,
    projectPaths: readonly ProjectLocation[],
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

  const scanDirectory = async (
    directory: string,
    projectPaths: readonly ProjectLocation[],
    isKnownFile: (file: string) => boolean,
  ) => {
    const discovered: DiscoveredPiSession[] = []
    for (const name of await readDirectoryNames(directory)) {
      if (!name.endsWith(PI_SESSION_FILE_SUFFIX)) continue
      const file = path.join(directory, name)
      listedFiles.add(file)
      if (isKnownFile(file)) continue
      const session = await discoveredSession(file, projectPaths)
      if (session) discovered.push(session)
    }
    return discovered
  }

  /** The files the current scan listed; what it did not list is forgotten when it ends. */
  const listedFiles = new Set<string>()
  const forgetUnlistedFiles = () => {
    for (const file of headers.keys()) if (!listedFiles.has(file)) headers.delete(file)
    listedFiles.clear()
  }

  /**
   * Pi reads `.pi/settings.json` only in the folder it runs in, so a project's sessions may be in
   * the project's own session directory or, for `pi` run in a folder inside it, in Pi's default
   * per-folder directories. Every candidate directory is scanned, and each file goes to the most
   * specific project its header's cwd is in, among all of them.
   */
  const scan = async ({ projectPaths, isKnownFile }: PiSessionDiscoveryInput) => {
    if (projectPaths.length === 0) return []
    const resolveDirectory = options.resolveSessionDirectory ?? resolvePiSessionDirectory
    const customDirectories = new Set<string>()
    for (const projectPath of projectPaths) {
      const custom = resolveDirectory(projectPath)
      if (custom) customDirectories.add(custom)
    }
    const sessionsRoot = options.sessionsRoot ?? path.join(getAgentDir(), 'sessions')
    const projects = await projectLocations(projectPaths)
    const prefixes = [
      ...new Set(projects.flatMap((project) => [project.projectPath, project.physicalPath])),
    ].map(encodedPathPrefix)
    const defaultDirectories = (await readDirectoryNames(sessionsRoot))
      .filter((name) => prefixes.some((prefix) => sessionDirectoryMayBelongTo(name, prefix)))
      .map((name) => path.join(sessionsRoot, name))
    const discovered = new Map<string, DiscoveredPiSession>()
    for (const directory of new Set([...customDirectories, ...defaultDirectories])) {
      for (const session of await scanDirectory(directory, projects, isKnownFile)) {
        discovered.set(session.piSessionFile, session)
      }
    }
    return [...discovered.values()]
  }

  return {
    scan: async (input) => {
      listedFiles.clear()
      try {
        return await scan(input)
      } finally {
        forgetUnlistedFiles()
      }
    },
  }
}
