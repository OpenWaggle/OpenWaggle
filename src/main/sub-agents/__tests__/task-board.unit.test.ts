import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { TaskId } from '@shared/types/brand'
import type { TaskRecord } from '@shared/types/team'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { state, getPathMock } = vi.hoisted(() => ({
  state: { userDataDir: '' },
  getPathMock: vi.fn(() => ''),
}))

getPathMock.mockImplementation(() => state.userDataDir)

// ---------------------------------------------------------------------------
// Mock the logger to suppress output during tests
// ---------------------------------------------------------------------------

vi.mock('../../logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

const mockEmitTeamEvent = vi.fn()
vi.mock('../sub-agent-bridge', () => ({
  emitTeamEvent: (...args: unknown[]) => mockEmitTeamEvent(...args),
}))

vi.mock('electron', () => ({
  app: {
    getPath: getPathMock,
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
  },
}))

// ---------------------------------------------------------------------------
// Import module under test after mocks are in place
// ---------------------------------------------------------------------------

import { resetAppRuntimeForTests } from '../../runtime'
import { readTeamRuntimeState, writeTeamRuntimeState } from '../../services/team-runtime-state'
import {
  clearAllBoards,
  createTask,
  deleteBoard,
  getTask,
  isBoardLoaded,
  listTasks,
  loadTaskBoard,
  persistTaskBoard,
  updateTask,
} from '../task-board'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function assertTaskRecord(result: unknown): asserts result is TaskRecord {
  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    throw new Error('Expected TaskRecord but got a non-object result')
  }
  if (Object.hasOwn(result, 'kind')) {
    throw new Error(
      `Expected TaskRecord but got discriminated union kind: ${String(Reflect.get(result, 'kind'))}`,
    )
  }
}

// ---------------------------------------------------------------------------
// Reset all state between tests
// ---------------------------------------------------------------------------

beforeEach(async () => {
  await resetAppRuntimeForTests()
  state.userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'task-board-db-'))
  clearAllBoards()
  mockEmitTeamEvent.mockClear()
})

afterEach(async () => {
  await resetAppRuntimeForTests()
  if (state.userDataDir) {
    await fs.rm(state.userDataDir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// createTask
// ---------------------------------------------------------------------------

describe('createTask', () => {
  it('creates a task with pending status and UUID IDs', () => {
    const t1 = createTask({ teamId: 'team-a', subject: 'First', description: 'Desc 1' })
    const t2 = createTask({ teamId: 'team-a', subject: 'Second', description: 'Desc 2' })

    expect(t1.id).toMatch(UUID_REGEX)
    expect(t2.id).toMatch(UUID_REGEX)
    expect(t1.id).not.toBe(t2.id)
    expect(t1.status).toBe('pending')
    expect(t2.status).toBe('pending')
  })

  it('initializes blocks and blockedBy as empty arrays', () => {
    const task = createTask({ teamId: 'team-a', subject: 'S', description: 'D' })

    expect(task.blocks).toEqual([])
    expect(task.blockedBy).toEqual([])
  })

  it('sets timestamps', () => {
    const before = Date.now()
    const task = createTask({ teamId: 'team-a', subject: 'S', description: 'D' })
    const after = Date.now()

    expect(task.createdAt).toBeGreaterThanOrEqual(before)
    expect(task.createdAt).toBeLessThanOrEqual(after)
    expect(task.updatedAt).toBe(task.createdAt)
  })

  it('stores optional activeForm', () => {
    const task = createTask({
      teamId: 'team-a',
      subject: 'S',
      description: 'D',
      activeForm: 'review',
    })

    expect(task.activeForm).toBe('review')
  })

  it('stores optional metadata', () => {
    const task = createTask({
      teamId: 'team-a',
      subject: 'S',
      description: 'D',
      metadata: { priority: 'high' },
    })

    expect(task.metadata).toEqual({ priority: 'high' })
  })

  it('defaults metadata to empty object when not provided', () => {
    const task = createTask({ teamId: 'team-a', subject: 'S', description: 'D' })

    expect(task.metadata).toEqual({})
  })

  it('generates unique IDs per team', () => {
    const a1 = createTask({ teamId: 'team-a', subject: 'A1', description: '' })
    const b1 = createTask({ teamId: 'team-b', subject: 'B1', description: '' })
    const a2 = createTask({ teamId: 'team-a', subject: 'A2', description: '' })

    expect(a1.id).toMatch(UUID_REGEX)
    expect(b1.id).toMatch(UUID_REGEX)
    expect(a2.id).toMatch(UUID_REGEX)
    expect(a1.id).not.toBe(a2.id)
    expect(a1.id).not.toBe(b1.id)
  })
})

// ---------------------------------------------------------------------------
// getTask
// ---------------------------------------------------------------------------

describe('getTask', () => {
  it('returns a task by team and id', () => {
    const created = createTask({ teamId: 'team-a', subject: 'S', description: 'D' })
    const found = getTask('team-a', created.id)

    expect(found).toEqual(created)
  })

  it('returns null for unknown task id', () => {
    createTask({ teamId: 'team-a', subject: 'S', description: 'D' })

    expect(getTask('team-a', TaskId('nonexistent'))).toBeNull()
  })

  it('returns null for unknown team', () => {
    createTask({ teamId: 'team-a', subject: 'S', description: 'D' })

    expect(getTask('team-nonexistent', TaskId('1'))).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// updateTask
// ---------------------------------------------------------------------------

describe('updateTask', () => {
  it('updates status', () => {
    const task = createTask({ teamId: 't', subject: 'S', description: 'D' })
    const result = updateTask({ teamId: 't', taskId: task.id, status: 'in_progress' })
    assertTaskRecord(result)

    expect(result.status).toBe('in_progress')
  })

  it('updates subject', () => {
    const task = createTask({ teamId: 't', subject: 'Old', description: 'D' })
    const result = updateTask({ teamId: 't', taskId: task.id, subject: 'New' })
    assertTaskRecord(result)

    expect(result.subject).toBe('New')
  })

  it('updates description', () => {
    const task = createTask({ teamId: 't', subject: 'S', description: 'Old' })
    const result = updateTask({ teamId: 't', taskId: task.id, description: 'New' })
    assertTaskRecord(result)

    expect(result.description).toBe('New')
  })

  it('updates activeForm', () => {
    const task = createTask({ teamId: 't', subject: 'S', description: 'D' })
    const result = updateTask({ teamId: 't', taskId: task.id, activeForm: 'deploy' })
    assertTaskRecord(result)

    expect(result.activeForm).toBe('deploy')
  })

  it('updates owner', () => {
    const task = createTask({ teamId: 't', subject: 'S', description: 'D' })
    const result = updateTask({ teamId: 't', taskId: task.id, owner: 'agent-1' })
    assertTaskRecord(result)

    expect(result.owner).toBe('agent-1')
  })

  it('advances updatedAt timestamp', () => {
    const task = createTask({ teamId: 't', subject: 'S', description: 'D' })
    const result = updateTask({ teamId: 't', taskId: task.id, subject: 'Changed' })
    assertTaskRecord(result)

    expect(result.updatedAt).toBeGreaterThanOrEqual(task.updatedAt)
  })

  it('preserves fields not included in the update', () => {
    const task = createTask({
      teamId: 't',
      subject: 'Keep',
      description: 'Also keep',
      activeForm: 'plan',
    })
    const result = updateTask({ teamId: 't', taskId: task.id, status: 'in_progress' })
    assertTaskRecord(result)

    expect(result.subject).toBe('Keep')
    expect(result.description).toBe('Also keep')
    expect(result.activeForm).toBe('plan')
  })

  it('returns not_found for unknown task', () => {
    const result = updateTask({ teamId: 't', taskId: TaskId('nonexistent'), subject: 'X' })

    expect(result).toEqual({ kind: 'not_found' })
  })

  // --- status 'deleted' special handling ---

  it('removes the task from the board when status is deleted', () => {
    const task = createTask({ teamId: 't', subject: 'S', description: 'D' })
    const result = updateTask({ teamId: 't', taskId: task.id, status: 'deleted' })
    assertTaskRecord(result)

    expect(result.status).toBe('deleted')
    expect(getTask('t', task.id)).toBeNull()
  })

  it('returns the task with deleted status when deleting', () => {
    const task = createTask({ teamId: 't', subject: 'S', description: 'D' })
    const result = updateTask({ teamId: 't', taskId: task.id, status: 'deleted' })
    assertTaskRecord(result)

    expect(result.id).toBe(task.id)
    expect(result.subject).toBe(task.subject)
    expect(result.status).toBe('deleted')
  })

  // --- addBlocks / addBlockedBy ---

  it('adds blocks and deduplicates via Set', () => {
    const task = createTask({ teamId: 't', subject: 'S', description: 'D' })

    updateTask({ teamId: 't', taskId: task.id, addBlocks: [TaskId('b1'), TaskId('b2')] })
    const result = updateTask({
      teamId: 't',
      taskId: task.id,
      addBlocks: [TaskId('b2'), TaskId('b3')],
    })
    assertTaskRecord(result)

    expect(result.blocks).toEqual([TaskId('b1'), TaskId('b2'), TaskId('b3')])
  })

  it('adds blockedBy and deduplicates via Set', () => {
    const task = createTask({ teamId: 't', subject: 'S', description: 'D' })

    updateTask({ teamId: 't', taskId: task.id, addBlockedBy: [TaskId('d1')] })
    const result = updateTask({
      teamId: 't',
      taskId: task.id,
      addBlockedBy: [TaskId('d1'), TaskId('d2')],
    })
    assertTaskRecord(result)

    expect(result.blockedBy).toEqual([TaskId('d1'), TaskId('d2')])
  })

  it('preserves existing blocks when addBlocks is not provided', () => {
    const task = createTask({ teamId: 't', subject: 'S', description: 'D' })
    updateTask({ teamId: 't', taskId: task.id, addBlocks: [TaskId('x1')] })
    const result = updateTask({ teamId: 't', taskId: task.id, subject: 'Changed' })
    assertTaskRecord(result)

    expect(result.blocks).toEqual([TaskId('x1')])
  })

  // --- metadata merge ---

  it('merges new metadata keys into existing', () => {
    const task = createTask({
      teamId: 't',
      subject: 'S',
      description: 'D',
      metadata: { a: 1 },
    })
    const result = updateTask({ teamId: 't', taskId: task.id, metadata: { b: 2 } })
    assertTaskRecord(result)

    expect(result.metadata).toEqual({ a: 1, b: 2 })
  })

  it('overwrites existing metadata keys', () => {
    const task = createTask({
      teamId: 't',
      subject: 'S',
      description: 'D',
      metadata: { a: 1 },
    })
    const result = updateTask({ teamId: 't', taskId: task.id, metadata: { a: 99 } })
    assertTaskRecord(result)

    expect(result.metadata).toEqual({ a: 99 })
  })

  it('deletes metadata keys when value is null', () => {
    const task = createTask({
      teamId: 't',
      subject: 'S',
      description: 'D',
      metadata: { a: 1, b: 2 },
    })
    const result = updateTask({ teamId: 't', taskId: task.id, metadata: { a: null } })
    assertTaskRecord(result)

    expect(result.metadata).toEqual({ b: 2 })
    expect('a' in result.metadata).toBe(false)
  })

  it('preserves metadata when metadata is not provided in update', () => {
    const task = createTask({
      teamId: 't',
      subject: 'S',
      description: 'D',
      metadata: { keep: true },
    })
    const result = updateTask({ teamId: 't', taskId: task.id, subject: 'New' })
    assertTaskRecord(result)

    expect(result.metadata).toEqual({ keep: true })
  })
})

// ---------------------------------------------------------------------------
// Status transition enforcement
// ---------------------------------------------------------------------------

describe('status transitions', () => {
  function seedTask(status: 'pending' | 'in_progress' | 'completed'): TaskRecord {
    const task = createTask({ teamId: 't', subject: `Task (${status})`, description: 'test' })
    if (status !== 'pending') {
      updateTask({ teamId: 't', taskId: task.id, status: 'in_progress' })
      if (status === 'completed') {
        updateTask({ teamId: 't', taskId: task.id, status: 'completed' })
      }
    }
    return task
  }

  it('pending → in_progress allowed', () => {
    const task = seedTask('pending')
    const result = updateTask({ teamId: 't', taskId: task.id, status: 'in_progress' })
    assertTaskRecord(result)
    expect(result.status).toBe('in_progress')
  })

  it('in_progress → completed allowed', () => {
    const task = seedTask('in_progress')
    const result = updateTask({ teamId: 't', taskId: task.id, status: 'completed' })
    assertTaskRecord(result)
    expect(result.status).toBe('completed')
  })

  it('in_progress → pending allowed (re-queue)', () => {
    const task = seedTask('in_progress')
    const result = updateTask({ teamId: 't', taskId: task.id, status: 'pending' })
    assertTaskRecord(result)
    expect(result.status).toBe('pending')
  })

  it('pending → deleted allowed', () => {
    const task = seedTask('pending')
    const result = updateTask({ teamId: 't', taskId: task.id, status: 'deleted' })
    assertTaskRecord(result)
    expect(result.status).toBe('deleted')
  })

  it('in_progress → deleted allowed', () => {
    const task = seedTask('in_progress')
    const result = updateTask({ teamId: 't', taskId: task.id, status: 'deleted' })
    assertTaskRecord(result)
    expect(result.status).toBe('deleted')
  })

  it('completed → deleted allowed', () => {
    const task = seedTask('completed')
    const result = updateTask({ teamId: 't', taskId: task.id, status: 'deleted' })
    assertTaskRecord(result)
    expect(result.status).toBe('deleted')
  })

  it('completed → pending rejected', () => {
    const task = seedTask('completed')
    const result = updateTask({ teamId: 't', taskId: task.id, status: 'pending' })
    expect(result).toEqual({
      kind: 'invalid_transition',
      detail: 'Cannot transition from "completed" to "pending"',
    })
  })

  it('completed → in_progress rejected', () => {
    const task = seedTask('completed')
    const result = updateTask({ teamId: 't', taskId: task.id, status: 'in_progress' })
    expect(result).toEqual({
      kind: 'invalid_transition',
      detail: 'Cannot transition from "completed" to "in_progress"',
    })
  })

  it('pending → completed rejected (must go through in_progress)', () => {
    const task = seedTask('pending')
    const result = updateTask({ teamId: 't', taskId: task.id, status: 'completed' })
    expect(result).toEqual({
      kind: 'invalid_transition',
      detail: 'Cannot transition from "pending" to "completed"',
    })
  })
})

// ---------------------------------------------------------------------------
// Cycle detection
// ---------------------------------------------------------------------------

describe('cycle detection', () => {
  it('rejects direct self-cycle (A blockedBy A)', () => {
    const a = createTask({ teamId: 't', subject: 'A', description: '' })
    const result = updateTask({ teamId: 't', taskId: a.id, addBlockedBy: [a.id] })

    expect(result).toEqual({
      kind: 'cycle_detected',
      detail: expect.stringContaining('dependency cycle'),
    })
  })

  it('rejects 2-node cycle (A blockedBy B, B blockedBy A)', () => {
    const a = createTask({ teamId: 't', subject: 'A', description: '' })
    const b = createTask({ teamId: 't', subject: 'B', description: '' })

    // A depends on B
    const r1 = updateTask({ teamId: 't', taskId: a.id, addBlockedBy: [b.id] })
    assertTaskRecord(r1)

    // B depends on A → cycle
    const r2 = updateTask({ teamId: 't', taskId: b.id, addBlockedBy: [a.id] })
    expect(r2).toEqual({
      kind: 'cycle_detected',
      detail: expect.stringContaining('dependency cycle'),
    })
  })

  it('rejects 3-node cycle (A→B→C→A)', () => {
    const a = createTask({ teamId: 't', subject: 'A', description: '' })
    const b = createTask({ teamId: 't', subject: 'B', description: '' })
    const c = createTask({ teamId: 't', subject: 'C', description: '' })

    updateTask({ teamId: 't', taskId: a.id, addBlockedBy: [b.id] })
    updateTask({ teamId: 't', taskId: b.id, addBlockedBy: [c.id] })

    // C depends on A → cycle
    const result = updateTask({ teamId: 't', taskId: c.id, addBlockedBy: [a.id] })
    expect(result).toEqual({
      kind: 'cycle_detected',
      detail: expect.stringContaining('dependency cycle'),
    })
  })

  it('accepts valid dependency chains', () => {
    const a = createTask({ teamId: 't', subject: 'A', description: '' })
    const b = createTask({ teamId: 't', subject: 'B', description: '' })
    const c = createTask({ teamId: 't', subject: 'C', description: '' })

    const r1 = updateTask({ teamId: 't', taskId: a.id, addBlockedBy: [b.id] })
    assertTaskRecord(r1)

    const r2 = updateTask({ teamId: 't', taskId: b.id, addBlockedBy: [c.id] })
    assertTaskRecord(r2)

    // Verify chain is intact
    expect(r1.blockedBy).toEqual([b.id])
    expect(r2.blockedBy).toEqual([c.id])
  })

  it('does not break existing deps on valid update', () => {
    const a = createTask({ teamId: 't', subject: 'A', description: '' })
    const b = createTask({ teamId: 't', subject: 'B', description: '' })
    const c = createTask({ teamId: 't', subject: 'C', description: '' })

    updateTask({ teamId: 't', taskId: a.id, addBlockedBy: [b.id] })

    // Adding a non-cycle dep to A should preserve existing B dep
    const result = updateTask({ teamId: 't', taskId: a.id, addBlockedBy: [c.id] })
    assertTaskRecord(result)

    expect(result.blockedBy).toEqual([b.id, c.id])
  })

  it('blocks does not trigger false positive on cycle detection', () => {
    const a = createTask({ teamId: 't', subject: 'A', description: '' })
    const b = createTask({ teamId: 't', subject: 'B', description: '' })

    // A blocks B (informational) — this should not prevent B from blockedBy A
    updateTask({ teamId: 't', taskId: a.id, addBlocks: [b.id] })
    const result = updateTask({ teamId: 't', taskId: b.id, addBlockedBy: [a.id] })
    assertTaskRecord(result)

    expect(result.blockedBy).toEqual([a.id])
  })
})

// ---------------------------------------------------------------------------
// listTasks
// ---------------------------------------------------------------------------

describe('listTasks', () => {
  it('returns tasks sorted by createdAt ascending', () => {
    const t1 = createTask({ teamId: 't', subject: 'First', description: '' })
    const t2 = createTask({ teamId: 't', subject: 'Second', description: '' })
    const t3 = createTask({ teamId: 't', subject: 'Third', description: '' })

    const tasks = listTasks('t')

    expect(tasks.map((t) => t.id)).toEqual([t1.id, t2.id, t3.id])
  })

  it('returns empty array for unknown team', () => {
    expect(listTasks('nonexistent')).toEqual([])
  })

  it('excludes tasks that were deleted via updateTask', () => {
    const t1 = createTask({ teamId: 't', subject: 'A', description: '' })
    const t2 = createTask({ teamId: 't', subject: 'B', description: '' })
    updateTask({ teamId: 't', taskId: t1.id, status: 'deleted' })

    const tasks = listTasks('t')
    expect(tasks).toHaveLength(1)
    expect(tasks[0].id).toBe(t2.id)
  })
})

// ---------------------------------------------------------------------------
// deleteBoard
// ---------------------------------------------------------------------------

describe('deleteBoard', () => {
  it('removes all tasks for a specific team', () => {
    createTask({ teamId: 'team-a', subject: 'A', description: '' })
    createTask({ teamId: 'team-b', subject: 'B', description: '' })

    deleteBoard('team-a')

    expect(listTasks('team-a')).toEqual([])
    expect(listTasks('team-b')).toHaveLength(1)
  })

  it('is a no-op for unknown team', () => {
    expect(() => deleteBoard('nonexistent')).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// clearAllBoards
// ---------------------------------------------------------------------------

describe('clearAllBoards', () => {
  it('removes all teams and their tasks', () => {
    createTask({ teamId: 'team-a', subject: 'A', description: '' })
    createTask({ teamId: 'team-b', subject: 'B', description: '' })

    clearAllBoards()

    expect(listTasks('team-a')).toEqual([])
    expect(listTasks('team-b')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Team independence
// ---------------------------------------------------------------------------

describe('team independence', () => {
  it('tasks in different teams do not interfere', () => {
    const a1 = createTask({ teamId: 'team-a', subject: 'A1', description: '' })
    createTask({ teamId: 'team-a', subject: 'A2', description: '' })
    const b1 = createTask({ teamId: 'team-b', subject: 'B1', description: '' })

    // Each team resolves its own tasks independently
    expect(getTask('team-a', a1.id)?.subject).toBe('A1')
    expect(getTask('team-b', b1.id)?.subject).toBe('B1')

    // team-b only has 1 task
    expect(listTasks('team-b')).toHaveLength(1)
    expect(listTasks('team-a')).toHaveLength(2)
  })

  it('updating a task in one team does not affect another', () => {
    const a = createTask({ teamId: 'team-a', subject: 'Original', description: '' })
    createTask({ teamId: 'team-b', subject: 'Original', description: '' })

    updateTask({ teamId: 'team-a', taskId: a.id, subject: 'Modified' })

    const bTask = listTasks('team-b')[0]
    expect(bTask.subject).toBe('Original')
  })

  it('deleting a board for one team leaves others intact', () => {
    createTask({ teamId: 'team-a', subject: 'A', description: '' })
    createTask({ teamId: 'team-b', subject: 'B', description: '' })

    deleteBoard('team-a')

    expect(listTasks('team-a')).toHaveLength(0)
    expect(listTasks('team-b')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// IPC event emissions
// ---------------------------------------------------------------------------

describe('IPC event emissions', () => {
  it('emits task_updated with status pending when a task is created', () => {
    createTask({ teamId: 't', subject: 'Test task', description: 'D' })

    expect(mockEmitTeamEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: 't',
        eventType: 'task_updated',
        data: expect.objectContaining({ subject: 'Test task', status: 'pending' }),
      }),
    )
  })

  it('emits task_updated when a task is updated', () => {
    const task = createTask({ teamId: 't', subject: 'S', description: 'D' })
    mockEmitTeamEvent.mockClear()

    updateTask({ teamId: 't', taskId: task.id, status: 'in_progress' })

    expect(mockEmitTeamEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: 't',
        eventType: 'task_updated',
        data: expect.objectContaining({ taskId: task.id, status: 'in_progress' }),
      }),
    )
  })

  it('emits task_updated with status deleted when a task is deleted', () => {
    const task = createTask({ teamId: 't', subject: 'S', description: 'D' })
    mockEmitTeamEvent.mockClear()

    updateTask({ teamId: 't', taskId: task.id, status: 'deleted' })

    expect(mockEmitTeamEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: 't',
        eventType: 'task_updated',
        data: expect.objectContaining({ taskId: task.id, status: 'deleted' }),
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

describe('persistence', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'task-board-test-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('persist writes valid JSON', async () => {
    createTask({ teamId: 'my-team', subject: 'Task 1', description: 'Desc' })
    createTask({ teamId: 'my-team', subject: 'Task 2', description: 'Desc 2' })

    await persistTaskBoard(tmpDir, 'my-team')

    const row = await readTeamRuntimeState(tmpDir, 'my-team')
    const raw = row?.tasks_json ?? '{}'
    const data: unknown = JSON.parse(raw)

    expect(data).toEqual(
      expect.objectContaining({
        tasks: expect.arrayContaining([
          expect.objectContaining({ subject: 'Task 1' }),
          expect.objectContaining({ subject: 'Task 2' }),
        ]),
      }),
    )
  })

  it('load restores correct data with branded types', async () => {
    const original = createTask({
      teamId: 'my-team',
      subject: 'Persist me',
      description: 'Detailed',
      metadata: { key: 'val' },
    })
    updateTask({
      teamId: 'my-team',
      taskId: original.id,
      addBlockedBy: [TaskId('some-dep')],
    })

    await persistTaskBoard(tmpDir, 'my-team')
    clearAllBoards()

    const loaded = await loadTaskBoard(tmpDir, 'my-team')
    expect(loaded).toBe(true)

    const restored = getTask('my-team', original.id)
    expect(restored).not.toBeNull()
    expect(restored?.subject).toBe('Persist me')
    expect(restored?.description).toBe('Detailed')
    expect(restored?.metadata).toEqual({ key: 'val' })
    expect(restored?.blockedBy).toEqual([TaskId('some-dep')])
  })

  it('round-trip preserves task integrity', async () => {
    const t1 = createTask({ teamId: 'rt', subject: 'A', description: 'Da' })
    const t2 = createTask({ teamId: 'rt', subject: 'B', description: 'Db' })
    updateTask({ teamId: 'rt', taskId: t2.id, addBlockedBy: [t1.id] })

    await persistTaskBoard(tmpDir, 'rt')

    const originalTasks = listTasks('rt')
    clearAllBoards()
    await loadTaskBoard(tmpDir, 'rt')
    const restoredTasks = listTasks('rt')

    expect(restoredTasks).toHaveLength(originalTasks.length)
    for (const orig of originalTasks) {
      const restored = restoredTasks.find((t) => t.id === orig.id)
      expect(restored).toBeDefined()
      expect(restored?.subject).toBe(orig.subject)
      expect(restored?.blockedBy).toEqual(orig.blockedBy)
    }
  })

  it('ENOENT returns false', async () => {
    const result = await loadTaskBoard(tmpDir, 'nonexistent-team')
    expect(result).toBe(false)
  })

  it('corrupt JSON returns false', async () => {
    await writeTeamRuntimeState({
      projectPath: tmpDir,
      teamName: 'corrupt',
      tasksJson: '{{invalid json!!',
    })

    const result = await loadTaskBoard(tmpDir, 'corrupt')
    expect(result).toBe(false)
  })

  it('isBoardLoaded reflects load state', async () => {
    expect(isBoardLoaded('my-team')).toBe(false)

    createTask({ teamId: 'my-team', subject: 'S', description: 'D' })
    await persistTaskBoard(tmpDir, 'my-team')
    clearAllBoards()

    expect(isBoardLoaded('my-team')).toBe(false)

    await loadTaskBoard(tmpDir, 'my-team')
    expect(isBoardLoaded('my-team')).toBe(true)
  })
})
