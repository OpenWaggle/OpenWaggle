import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { MCP_CONFIG } from '@shared/constants/mcp'
import type { McpTaskRecord } from '@shared/types/mcp'

interface TaskFile {
  readonly version: 1
  readonly tasks: readonly McpTaskRecord[]
}

const FILE_MODE = 0o600
const MAX_TASK_RECORDS = 2_000
const REQUIRED_STRING_FIELDS = [
  'id',
  'remoteTaskId',
  'serverInstanceId',
  'serverLabel',
  'sessionId',
  'projectPath',
  'protocolVersion',
  'configHash',
  'schemaHash',
  'status',
] as const

export interface McpRemoteTaskStore {
  list(input?: {
    readonly projectPath?: string | null
    readonly sessionId?: string | null
    readonly serverInstanceId?: string | null
  }): Promise<readonly McpTaskRecord[]>
  upsert(records: readonly McpTaskRecord[]): Promise<readonly McpTaskRecord[]>
  setDisabled(input: {
    readonly sessionId: string
    readonly enabledServers?: readonly {
      readonly instanceId: string
      readonly configHash: string
    }[]
    readonly disabled: boolean
  }): Promise<void>
  setAllDisabled(): Promise<void>
}

function isTaskRecord(value: unknown): value is McpTaskRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = Object.fromEntries(Object.entries(value))
  const hasStrings = REQUIRED_STRING_FIELDS.every((field) => typeof record[field] === 'string')
  const hasProvenance = typeof record.provenance === 'object' && record.provenance !== null
  return (
    hasStrings &&
    typeof record.updatedAt === 'number' &&
    typeof record.disabled === 'boolean' &&
    hasProvenance &&
    record.task !== undefined
  )
}

function selectTasks(
  tasks: readonly McpTaskRecord[],
  input?: {
    readonly projectPath?: string | null
    readonly sessionId?: string | null
    readonly serverInstanceId?: string | null
  },
) {
  return tasks.filter(
    (task) =>
      (!input?.projectPath || task.projectPath === input.projectPath) &&
      (!input?.sessionId || task.sessionId === input.sessionId) &&
      (!input?.serverInstanceId || task.serverInstanceId === input.serverInstanceId),
  )
}

function upsertTasks(
  tasks: readonly McpTaskRecord[],
  records: readonly McpTaskRecord[],
): readonly McpTaskRecord[] {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  for (const record of records) byId.set(record.id, record)
  return [...byId.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_TASK_RECORDS)
}

export class InMemoryMcpRemoteTaskStore implements McpRemoteTaskStore {
  private tasks: readonly McpTaskRecord[] = []

  async list(input?: Parameters<McpRemoteTaskStore['list']>[0]) {
    return selectTasks(this.tasks, input)
  }

  async upsert(records: readonly McpTaskRecord[]) {
    this.tasks = upsertTasks(this.tasks, records)
    return records
  }

  async setDisabled(input: Parameters<McpRemoteTaskStore['setDisabled']>[0]) {
    const enabled = new Set(
      (input.enabledServers ?? []).map((server) => `${server.instanceId}\0${server.configHash}`),
    )
    this.tasks = this.tasks.map((task) =>
      task.sessionId === input.sessionId &&
      (input.disabled || !enabled.has(`${task.serverInstanceId}\0${task.configHash}`))
        ? { ...task, disabled: true }
        : task.sessionId === input.sessionId
          ? { ...task, disabled: false }
          : task,
    )
  }

  async setAllDisabled() {
    this.tasks = this.tasks.map((task) => ({ ...task, disabled: true }))
  }
}

async function readFileTasks(filePath: string): Promise<readonly McpTaskRecord[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null || !('tasks' in parsed)) {
      throw new Error('The MCP Task store has an invalid structure.')
    }
    const tasks = parsed.tasks
    if (!Array.isArray(tasks)) throw new Error('The MCP Task store has an invalid task list.')
    return tasks.filter(isTaskRecord)
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return []
    }
    throw error
  }
}

async function writeFileTasks(filePath: string, tasks: readonly McpTaskRecord[]) {
  await mkdir(dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  const contents: TaskFile = { version: 1, tasks }
  await writeFile(
    temporaryPath,
    `${JSON.stringify(contents, null, MCP_CONFIG.JSON_INDENT_SPACES)}\n`,
    { encoding: 'utf8', mode: FILE_MODE },
  )
  await rename(temporaryPath, filePath)
}

export class FileMcpRemoteTaskStore implements McpRemoteTaskStore {
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  list(input?: Parameters<McpRemoteTaskStore['list']>[0]) {
    return this.queue.then(async () => selectTasks(await readFileTasks(this.filePath), input))
  }

  async upsert(records: readonly McpTaskRecord[]) {
    await this.mutate((tasks) => upsertTasks(tasks, records))
    return records
  }

  async setDisabled(input: Parameters<McpRemoteTaskStore['setDisabled']>[0]) {
    const enabled = new Set(
      (input.enabledServers ?? []).map((server) => `${server.instanceId}\0${server.configHash}`),
    )
    await this.mutate((tasks) =>
      tasks.map((task) =>
        task.sessionId === input.sessionId &&
        (input.disabled || !enabled.has(`${task.serverInstanceId}\0${task.configHash}`))
          ? { ...task, disabled: true }
          : task.sessionId === input.sessionId
            ? { ...task, disabled: false }
            : task,
      ),
    )
  }

  async setAllDisabled() {
    await this.mutate((tasks) => tasks.map((task) => ({ ...task, disabled: true })))
  }

  private async mutate(update: (tasks: readonly McpTaskRecord[]) => readonly McpTaskRecord[]) {
    const write = this.queue.then(async () => {
      const tasks = update(await readFileTasks(this.filePath))
      await writeFileTasks(this.filePath, tasks)
    })
    this.queue = write.catch(() => undefined)
    await write
  }
}
