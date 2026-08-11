import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { MCP_CONFIG } from '@shared/constants/mcp'
import { isRecord } from './openwaggle-mcp-server-policy'

export interface SessionHandoffMetadata {
  readonly summary: string
  readonly createdAt: number
  readonly createdByProfile: string
  readonly originSessionId?: string
}

export interface SessionControlMetadata {
  readonly sessionId: string
  readonly pinned: boolean
  readonly depth: number
  readonly updatedAt: number
  readonly handoff?: SessionHandoffMetadata
}

interface SessionMetadataFile {
  readonly version: 1
  readonly sessions: readonly SessionControlMetadata[]
}

const FILE_MODE = 0o600
const MAX_METADATA_RECORDS = 10_000

function parseMetadata(value: unknown): SessionControlMetadata | null {
  if (
    !isRecord(value) ||
    typeof value.sessionId !== 'string' ||
    typeof value.pinned !== 'boolean' ||
    typeof value.depth !== 'number' ||
    !Number.isInteger(value.depth) ||
    value.depth < 0 ||
    typeof value.updatedAt !== 'number'
  ) {
    return null
  }
  const handoff = value.handoff
  return {
    sessionId: value.sessionId,
    pinned: value.pinned,
    depth: value.depth,
    updatedAt: value.updatedAt,
    ...(isRecord(handoff) &&
    typeof handoff.summary === 'string' &&
    typeof handoff.createdAt === 'number' &&
    typeof handoff.createdByProfile === 'string'
      ? {
          handoff: {
            summary: handoff.summary,
            createdAt: handoff.createdAt,
            createdByProfile: handoff.createdByProfile,
            ...(typeof handoff.originSessionId === 'string'
              ? { originSessionId: handoff.originSessionId }
              : {}),
          },
        }
      : {}),
  }
}

async function readMetadataFile(filePath: string): Promise<SessionMetadataFile> {
  try {
    const value: unknown = JSON.parse(await readFile(filePath, 'utf8'))
    if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.sessions)) {
      throw new Error('The OpenWaggle MCP session metadata store has an invalid structure.')
    }
    return {
      version: 1,
      sessions: value.sessions.map(parseMetadata).filter((item) => item !== null),
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
    const operation = this.queue.then(async () => {
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
    })
    this.queue = operation.catch(() => undefined)
    await operation
    if (!result) throw new Error('OpenWaggle MCP session metadata mutation returned no result.')
    return result
  }

  setDepth(sessionId: string, depth: number) {
    return this.update(sessionId, (current) => ({ ...current, depth, updatedAt: Date.now() }))
  }
}
