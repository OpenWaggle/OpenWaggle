import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { getAgentDir } from '@earendil-works/pi-coding-agent'
import type {
  DiscoveredPiSession,
  PiSessionDiscoveryInput,
  PiSessionTitleSource,
} from '../../ports/pi-session-discovery'
import { resolvePiSessionDirectory } from './pi-session-directory'
import { type PiSessionFileHeader, readPiSessionFileHeader } from './pi-session-file-prefix'
import {
  encodedPathPrefix,
  owningProject,
  type ProjectLocation,
  projectLocations,
  sessionDirectoryMayBelongTo,
} from './pi-session-project-paths'

/**
 * Pi session discovery (ADR 0051): finds Pi sessions the `pi` CLI created inside an OpenWaggle
 * project without loading their transcripts.
 *
 * Pi keeps one directory per working directory under `<agent dir>/sessions`, named from the path
 * (`/a/b` becomes `--a-b--`). A project's sessions, and those of every folder inside it, live in
 * the directories whose name starts with the project's encoding. The encoding is ambiguous
 * (`/a/b-c` and `/a/b/c` encode alike), so a candidate is confirmed from the `cwd` in its header.
 * Only a bounded prefix of each new file is read: the header, the first user message, and an early
 * `/name`. Pi's own `SessionManager.list` streams every file in full, which is too slow to repeat
 * across thousands of sessions. Pi records the whole system prompt, with every tool schema, before
 * the first user message (88–165 KB in real sessions), so a file whose first 64 KiB hold no user
 * message is read further, up to a bound.
 */

const PI_SESSION_FILE_SUFFIX = '.jsonl'

export interface PiSessionDiscoveryScanner {
  readonly scan: (input: PiSessionDiscoveryInput) => Promise<readonly DiscoveredPiSession[]>
  /**
   * What titles a file OpenWaggle already lists, from the same bounded read; null when it is not
   * a Pi session or cannot be read. A file is read again only once it changed.
   */
  readonly titleSource: (piSessionFile: string) => Promise<PiSessionTitleSource | null>
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
    const header = await readPiSessionFileHeader(file)
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
      firstUserMessageAt: header.firstUserMessageAt,
      model: header.model,
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

  const titleSource = async (file: string): Promise<PiSessionTitleSource | null> => {
    const state = await fileState(file)
    if (state === null) return null
    const header = await headerOf(file, state)
    if (!header) return null
    return {
      name: header.name,
      firstUserMessage: header.firstUserMessage,
      firstUserMessageAt: header.firstUserMessageAt,
      model: header.model,
    }
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
    titleSource,
  }
}
