import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { TaskId, TeamId } from '@shared/types/brand'
import type { TaskRecord, TaskStatus } from '@shared/types/team'
import { formatErrorMessage, isEnoent } from '@shared/utils/node-error'
import { z } from 'zod'
import { createLogger } from '../logger'
import { atomicWriteJSON } from '../utils/atomic-write'
import { emitTeamEvent } from './sub-agent-bridge'

const logger = createLogger('task-board')

const boards = new Map<string, Map<TaskId, TaskRecord>>()
const loadedBoards = new Set<string>()

function getBoard(teamId: string): Map<TaskId, TaskRecord> {
  let board = boards.get(teamId)
  if (!board) {
    board = new Map()
    boards.set(teamId, board)
  }
  return board
}

export interface CreateTaskInput {
  readonly teamId: string
  readonly subject: string
  readonly description: string
  readonly activeForm?: string
  readonly metadata?: Record<string, unknown>
}

export function createTask(input: CreateTaskInput): TaskRecord {
  const board = getBoard(input.teamId)
  const id = TaskId(randomUUID())
  const now = Date.now()

  const task: TaskRecord = {
    id,
    subject: input.subject,
    description: input.description,
    activeForm: input.activeForm,
    status: 'pending',
    blocks: [],
    blockedBy: [],
    metadata: input.metadata ?? {},
    createdAt: now,
    updatedAt: now,
  }

  board.set(id, task)

  emitTeamEvent({
    teamId: TeamId(input.teamId),
    eventType: 'task_updated',
    timestamp: Date.now(),
    data: { taskId: id, subject: input.subject, status: 'pending' },
  })

  logger.info('Task created', { teamId: input.teamId, taskId: id, subject: input.subject })
  return task
}

export interface UpdateTaskInput {
  readonly teamId: string
  readonly taskId: TaskId
  readonly status?: TaskStatus
  readonly subject?: string
  readonly description?: string
  readonly activeForm?: string
  readonly owner?: string
  readonly addBlocks?: readonly TaskId[]
  readonly addBlockedBy?: readonly TaskId[]
  readonly metadata?: Record<string, unknown>
}

export type UpdateTaskResult =
  | TaskRecord
  | { readonly kind: 'not_found' }
  | { readonly kind: 'cycle_detected'; readonly detail: string }
  | { readonly kind: 'invalid_transition'; readonly detail: string }

const VALID_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  pending: ['in_progress', 'deleted'],
  in_progress: ['completed', 'pending', 'deleted'],
  completed: ['deleted'],
  deleted: [],
}

export function updateTask(input: UpdateTaskInput): UpdateTaskResult {
  const board = getBoard(input.teamId)
  const existing = board.get(input.taskId)
  if (!existing) return { kind: 'not_found' }

  if (input.status && !VALID_TRANSITIONS[existing.status].includes(input.status)) {
    return {
      kind: 'invalid_transition',
      detail: `Cannot transition from "${existing.status}" to "${input.status}"`,
    }
  }

  if (input.status === 'deleted') {
    board.delete(input.taskId)

    emitTeamEvent({
      teamId: TeamId(input.teamId),
      eventType: 'task_updated',
      timestamp: Date.now(),
      data: { taskId: input.taskId, status: 'deleted' },
    })

    logger.info('Task deleted', { teamId: input.teamId, taskId: input.taskId })
    return { ...existing, status: 'deleted', updatedAt: Date.now() }
  }

  const blocks = input.addBlocks
    ? [...new Set([...existing.blocks, ...input.addBlocks])]
    : [...existing.blocks]

  const proposedBlockedBy = input.addBlockedBy
    ? [...new Set([...existing.blockedBy, ...input.addBlockedBy])]
    : [...existing.blockedBy]

  // Check for cycles before applying the update
  if (input.addBlockedBy && input.addBlockedBy.length > 0) {
    if (wouldCreateCycle(board, input.taskId, proposedBlockedBy)) {
      return {
        kind: 'cycle_detected',
        detail: `Adding blockedBy [${input.addBlockedBy.join(', ')}] to task ${input.taskId} would create a dependency cycle`,
      }
    }
  }

  const blockedBy = proposedBlockedBy

  const mergedMetadata = input.metadata
    ? mergeMetadata(existing.metadata, input.metadata)
    : existing.metadata

  const updated: TaskRecord = {
    ...existing,
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.subject !== undefined ? { subject: input.subject } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.activeForm !== undefined ? { activeForm: input.activeForm } : {}),
    ...(input.owner !== undefined ? { owner: input.owner } : {}),
    blocks,
    blockedBy,
    metadata: mergedMetadata,
    updatedAt: Date.now(),
  }

  board.set(input.taskId, updated)

  emitTeamEvent({
    teamId: TeamId(input.teamId),
    eventType: 'task_updated',
    timestamp: Date.now(),
    data: { taskId: input.taskId, status: updated.status },
  })

  return updated
}

export function getTask(teamId: string, taskId: TaskId): TaskRecord | null {
  const board = getBoard(teamId)
  return board.get(taskId) ?? null
}

export function listTasks(teamId: string): readonly TaskRecord[] {
  const board = getBoard(teamId)
  const tasks: TaskRecord[] = []
  for (const task of board.values()) {
    tasks.push(task)
  }
  return tasks.sort((a, b) => a.createdAt - b.createdAt)
}

export function deleteBoard(teamId: string): void {
  boards.delete(teamId)
  loadedBoards.delete(teamId)
}

export function clearAllBoards(): void {
  boards.clear()
  loadedBoards.clear()
}

// ── Persistence ──────────────────────────────────────────────

const persistedTaskSchema = z.object({
  id: z.string(),
  subject: z.string(),
  description: z.string(),
  activeForm: z.string().optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'deleted']),
  owner: z.string().optional(),
  blocks: z.array(z.string()),
  blockedBy: z.array(z.string()),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.number(),
  updatedAt: z.number(),
})

const persistedBoardSchema = z.object({
  tasks: z.array(persistedTaskSchema),
})

export function isBoardLoaded(teamId: string): boolean {
  return loadedBoards.has(teamId)
}

export async function persistTaskBoard(projectPath: string, teamName: string): Promise<void> {
  const board = boards.get(teamName)
  if (!board) return

  const tasks = [...board.values()].map((t) => ({
    id: t.id,
    subject: t.subject,
    description: t.description,
    activeForm: t.activeForm,
    status: t.status,
    owner: t.owner,
    blocks: [...t.blocks],
    blockedBy: [...t.blockedBy],
    metadata: { ...t.metadata },
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }))

  const dir = path.join(projectPath, '.openwaggle', 'teams', teamName)
  await fs.mkdir(dir, { recursive: true })

  const filePath = path.join(dir, 'tasks.json')
  await atomicWriteJSON(filePath, { tasks })
  logger.info('Task board persisted', { teamName, taskCount: tasks.length })
}

export async function loadTaskBoard(projectPath: string, teamName: string): Promise<boolean> {
  const filePath = path.join(projectPath, '.openwaggle', 'teams', teamName, 'tasks.json')
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    const data = persistedBoardSchema.parse(parsed)

    const board = getBoard(teamName)
    board.clear()

    for (const t of data.tasks) {
      const record: TaskRecord = {
        id: TaskId(t.id),
        subject: t.subject,
        description: t.description,
        activeForm: t.activeForm,
        status: t.status,
        owner: t.owner,
        blocks: t.blocks.map((id) => TaskId(id)),
        blockedBy: t.blockedBy.map((id) => TaskId(id)),
        metadata: t.metadata,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      }
      board.set(record.id, record)
    }

    loadedBoards.add(teamName)
    logger.info('Task board loaded', { teamName, taskCount: data.tasks.length })
    return true
  } catch (error) {
    if (!isEnoent(error)) {
      logger.warn('Failed to load task board', {
        teamName,
        error: formatErrorMessage(error),
      })
    }
    return false
  }
}

/**
 * DFS cycle detection on the blockedBy graph.
 * Returns true if adding `proposedBlockedBy` edges to `taskId` would create a cycle.
 */
function wouldCreateCycle(
  board: ReadonlyMap<TaskId, TaskRecord>,
  taskId: TaskId,
  proposedBlockedBy: readonly TaskId[],
): boolean {
  // Build adjacency: task → set of tasks it's blocked by
  const adjacency = new Map<string, Set<string>>()
  for (const [id, task] of board) {
    adjacency.set(id, new Set(task.blockedBy))
  }
  // Apply proposed edges
  const current = adjacency.get(taskId) ?? new Set()
  for (const dep of proposedBlockedBy) {
    current.add(dep)
  }
  adjacency.set(taskId, current)

  // DFS from taskId's proposed deps, looking for a path back to taskId
  const visited = new Set<string>()
  const stack = [...proposedBlockedBy.map(String)]

  let node = stack.pop()
  while (node !== undefined) {
    if (node === taskId) return true
    if (visited.has(node)) {
      node = stack.pop()
      continue
    }
    visited.add(node)
    const neighbors = adjacency.get(node)
    if (neighbors) {
      for (const neighbor of neighbors) {
        stack.push(neighbor)
      }
    }
    node = stack.pop()
  }

  return false
}

function mergeMetadata(
  existing: Readonly<Record<string, unknown>>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...existing }
  for (const [key, value] of Object.entries(incoming)) {
    if (value === null) {
      delete result[key]
    } else {
      result[key] = value
    }
  }
  return result
}
