import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { MCP_CONFIG } from '@shared/constants/mcp'
import type { SessionDelegationState } from '@shared/types/session'
import { withProcessFileLock } from './adapters/mcp/process-file-lock'
import { isRecord } from './openwaggle-mcp-server-policy'

export type ServerTaskStatus =
  | 'queued'
  | 'working'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'

export interface ServerTaskLease {
  readonly ownerId: string
  readonly expiresAt: number
}

export interface ServerTaskRecord {
  readonly id: string
  readonly callerProfile: string
  readonly parentSessionId?: string
  readonly sessionId?: string
  readonly projectPath: string
  readonly model: string
  readonly objective: string
  readonly delegationDepth?: number
  readonly status: ServerTaskStatus
  readonly createdAt: number
  readonly updatedAt: number
  readonly result?: unknown
  readonly error?: string
  readonly action?: string
  readonly lease?: ServerTaskLease | null
  readonly cancellationRequestedAt?: number
  readonly projectedDelegationState?: SessionDelegationState
}

interface ServerTaskFile {
  readonly version: 1
  readonly tasks: readonly ServerTaskRecord[]
}

const MAX_TERMINAL_TASKS = 1_000
const TASK_STORE_FILE_MODE = 0o600

function isTaskStatus(value: unknown): value is ServerTaskStatus {
  return (
    value === 'queued' ||
    value === 'working' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'cancelled' ||
    value === 'interrupted'
  )
}

function optionalDelegationDepth(value: unknown) {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MCP_CONFIG.MAX_ORCHESTRATION_DEPTH
    ? { delegationDepth: value }
    : {}
}

function optionalLease(value: unknown) {
  if (!isRecord(value) || typeof value.ownerId !== 'string' || value.ownerId.length === 0) return {}
  if (typeof value.expiresAt !== 'number' || !Number.isFinite(value.expiresAt)) return {}
  return { lease: { ownerId: value.ownerId, expiresAt: value.expiresAt } }
}

function optionalTaskFields(value: Record<string, unknown>) {
  return {
    ...optionalDelegationDepth(value.delegationDepth),
    ...(typeof value.parentSessionId === 'string'
      ? { parentSessionId: value.parentSessionId }
      : {}),
    ...(typeof value.sessionId === 'string' ? { sessionId: value.sessionId } : {}),
    ...(value.result === undefined ? {} : { result: value.result }),
    ...(typeof value.error === 'string' ? { error: value.error } : {}),
    ...(typeof value.action === 'string' ? { action: value.action } : {}),
    ...optionalLease(value.lease),
    ...(typeof value.cancellationRequestedAt === 'number' &&
    Number.isFinite(value.cancellationRequestedAt)
      ? { cancellationRequestedAt: value.cancellationRequestedAt }
      : {}),
    ...(isDelegationState(value.projectedDelegationState)
      ? { projectedDelegationState: value.projectedDelegationState }
      : {}),
  }
}

function isDelegationState(value: unknown): value is SessionDelegationState {
  return (
    value === 'working' ||
    value === 'waiting' ||
    value === 'needs_attention' ||
    value === 'ready_for_review' ||
    value === 'revision_requested' ||
    value === 'accepted' ||
    value === 'cancelled'
  )
}

function parseTask(value: unknown): ServerTaskRecord | null {
  if (!isRecord(value)) return null
  if (
    typeof value.id !== 'string' ||
    typeof value.callerProfile !== 'string' ||
    typeof value.projectPath !== 'string' ||
    typeof value.model !== 'string' ||
    typeof value.objective !== 'string' ||
    !isTaskStatus(value.status) ||
    typeof value.createdAt !== 'number' ||
    typeof value.updatedAt !== 'number'
  ) {
    return null
  }
  return {
    id: value.id,
    callerProfile: value.callerProfile,
    projectPath: value.projectPath,
    model: value.model,
    objective: value.objective,
    status: value.status,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    ...optionalTaskFields(value),
  }
}

async function readTaskFile(filePath: string): Promise<ServerTaskFile> {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, 'utf8'))
    if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.tasks)) {
      throw new Error('The OpenWaggle MCP task store has an invalid structure.')
    }
    return { version: 1, tasks: parsed.tasks.map(parseTask).filter((task) => task !== null) }
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return { version: 1, tasks: [] }
    throw error
  }
}

async function writeTaskFile(filePath: string, tasks: readonly ServerTaskRecord[]) {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  const sorted = [...tasks].sort((a, b) => b.updatedAt - a.updatedAt)
  const now = Date.now()
  const retainedAuthority = sorted.filter(
    (task) =>
      !isTerminalTaskStatus(task.status) || Boolean(task.lease && task.lease.expiresAt > now),
  )
  const retainedTerminal = sorted
    .filter(
      (task) => isTerminalTaskStatus(task.status) && !(task.lease && task.lease.expiresAt > now),
    )
    .slice(0, MAX_TERMINAL_TASKS)
  const value = {
    version: 1,
    tasks: [...retainedAuthority, ...retainedTerminal].sort((a, b) => b.updatedAt - a.updatedAt),
  }
  await writeFile(
    temporaryPath,
    `${JSON.stringify(value, null, MCP_CONFIG.JSON_INDENT_SPACES)}\n`,
    { encoding: 'utf8', mode: TASK_STORE_FILE_MODE },
  )
  await rename(temporaryPath, filePath)
}

export function isTerminalTaskStatus(status: ServerTaskStatus) {
  return (
    status === 'completed' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'interrupted'
  )
}

export class OpenWaggleMcpTaskStore {
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  readTasks() {
    return this.queue.then(async () => (await readTaskFile(this.filePath)).tasks)
  }

  withProjectionLock<T>(operation: () => Promise<T>) {
    return withProcessFileLock(`${this.filePath}.projection`, operation)
  }

  async update<T>(
    mutation: (tasks: readonly ServerTaskRecord[]) => {
      tasks: readonly ServerTaskRecord[]
      result: T
    },
  ) {
    let operationResult: T | undefined
    const write = this.queue.then(() =>
      withProcessFileLock(this.filePath, async () => {
        const current = await readTaskFile(this.filePath)
        const next = mutation(current.tasks)
        operationResult = next.result
        await writeTaskFile(this.filePath, next.tasks)
      }),
    )
    this.queue = write.catch(() => undefined)
    await write
    if (operationResult === undefined)
      throw new Error('OpenWaggle MCP task mutation returned no result.')
    return operationResult
  }
}
