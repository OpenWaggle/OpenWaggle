import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { MCP_CONFIG } from '@shared/constants/mcp'
import { withProcessFileLock } from './adapters/mcp/process-file-lock'
import { isRecord } from './openwaggle-mcp-server-policy'
import { parseSessionControlMetadata } from './openwaggle-mcp-session-metadata-parser'

export interface SessionHandoffMetadata {
  readonly summary: string
  readonly createdAt: number
  readonly createdByProfile: string
  readonly originSessionId?: string
}

export interface HostedSessionWorktreePlanMetadata {
  readonly baseRef: string | null
  readonly startFromOrigin: boolean
}

export interface HostedSessionWorktreeMetadata {
  readonly sourceSessionId: string
  readonly sourceProjectPath: string
  readonly projectPath: string
  readonly branch: string
  readonly baseRef: string
  readonly requestedBaseRef: string | null
  readonly startFromOrigin: boolean
  readonly createdAt: number
}

export interface HostedDerivedWorktreeMetadata {
  readonly sessionId: string
  readonly projectPath: string
  readonly branch: string
  readonly baseRef: string
  readonly requestedBaseRef: string | null
  readonly startFromOrigin: boolean
  readonly createdAt: number
}

export interface HostedOwnedSessionMetadata {
  readonly profile: string
  readonly projectPath: string | null
  readonly sourceSessionId?: string
  readonly sourceProjectPath?: string | null
  readonly createdAt: number
}

export interface SessionControlMetadata {
  readonly sessionId: string
  readonly pinned: boolean
  readonly depth: number
  readonly updatedAt: number
  readonly handoff?: SessionHandoffMetadata
  readonly worktreePlan?: HostedSessionWorktreePlanMetadata
  readonly worktree?: HostedSessionWorktreeMetadata
  readonly derivedWorktree?: HostedDerivedWorktreeMetadata
  readonly ownedSession?: HostedOwnedSessionMetadata
}

interface SessionMetadataFile {
  readonly version: 1
  readonly sessions: readonly SessionControlMetadata[]
}

const FILE_MODE = 0o600
const MAX_METADATA_RECORDS = 10_000

async function readMetadataFile(filePath: string): Promise<SessionMetadataFile> {
  try {
    const value: unknown = JSON.parse(await readFile(filePath, 'utf8'))
    if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.sessions)) {
      throw new Error('The OpenWaggle MCP session metadata store has an invalid structure.')
    }
    return {
      version: 1,
      sessions: value.sessions.map(parseSessionControlMetadata).filter((item) => item !== null),
    }
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return { version: 1, sessions: [] }
    throw error
  }
}

async function writeMetadataFile(filePath: string, sessions: readonly SessionControlMetadata[]) {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(
    temporaryPath,
    `${JSON.stringify(
      {
        version: 1,
        sessions: [...sessions]
          .sort((left, right) => right.updatedAt - left.updatedAt)
          .slice(0, MAX_METADATA_RECORDS),
      },
      null,
      MCP_CONFIG.JSON_INDENT_SPACES,
    )}\n`,
    { encoding: 'utf8', mode: FILE_MODE },
  )
  await rename(temporaryPath, filePath)
}

export function sessionMetadataStorePath(taskStorePath: string) {
  return path.join(path.dirname(taskStorePath), 'mcp-server-session-metadata.json')
}

export class OpenWaggleMcpSessionMetadataStore {
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  async get(sessionId: string) {
    const sessions = await this.list()
    return sessions.find((item) => item.sessionId === sessionId)
  }

  list() {
    return this.queue.then(async () => (await readMetadataFile(this.filePath)).sessions)
  }

  async depth(sessionId: string | undefined) {
    if (!sessionId) return 0
    return (await this.get(sessionId))?.depth ?? 0
  }

  async update(
    sessionId: string,
    mutation: (current: SessionControlMetadata) => SessionControlMetadata,
  ) {
    let result: SessionControlMetadata | undefined
    const operation = this.queue.then(() =>
      withProcessFileLock(this.filePath, async () => {
        const file = await readMetadataFile(this.filePath)
        const current = file.sessions.find((item) => item.sessionId === sessionId) ?? {
          sessionId,
          pinned: false,
          depth: 0,
          updatedAt: Date.now(),
        }
        result = mutation(current)
        await writeMetadataFile(this.filePath, [
          result,
          ...file.sessions.filter((item) => item.sessionId !== sessionId),
        ])
      }),
    )
    this.queue = operation.catch(() => undefined)
    await operation
    if (!result) throw new Error('OpenWaggle MCP session metadata mutation returned no result.')
    return result
  }

  setDepth(sessionId: string, depth: number) {
    return this.update(sessionId, (current) => ({ ...current, depth, updatedAt: Date.now() }))
  }

  setOwnedSession(
    sessionId: string,
    input: Omit<HostedOwnedSessionMetadata, 'createdAt'> & { readonly createdAt?: number },
  ) {
    return this.update(sessionId, (current) => ({
      ...current,
      ownedSession: { ...input, createdAt: input.createdAt ?? Date.now() },
      updatedAt: Date.now(),
    }))
  }

  withSessionWorktreeLock<T>(sessionId: string, operation: () => Promise<T>) {
    const sessionHash = createHash('sha256').update(sessionId).digest('hex')
    const lockPath = `${this.filePath}.${sessionHash}.worktree`
    return withProcessFileLock(lockPath, operation)
  }
}
