import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ConversationId } from '@shared/types/brand'
import type { TaskRecord } from '@shared/types/team'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { state, getPathMock } = vi.hoisted(() => ({
  state: { userDataDir: '' },
  getPathMock: vi.fn(() => ''),
}))

getPathMock.mockImplementation(() => state.userDataDir)

// ---------------------------------------------------------------------------
// Mocks — IPC bridge + context injection
// ---------------------------------------------------------------------------

vi.mock('../../logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

vi.mock('../sub-agent-bridge', () => ({
  emitTeamEvent: vi.fn(),
}))

const mockPushContext = vi.fn()
vi.mock('../../tools/context-injection-buffer', () => ({
  pushContext: (...args: unknown[]) => mockPushContext(...args),
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
// Module imports — after mocks
// ---------------------------------------------------------------------------

import { resetAppRuntimeForTests } from '../../runtime'
import {
  clearAllMessages,
  deliverPendingMessages,
  getPendingMessageCount,
  loadPendingMessages,
  persistPendingMessages,
  sendAgentMessage,
} from '../message-bus'
import {
  clearAllBoards,
  createTask,
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
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string

beforeEach(async () => {
  await resetAppRuntimeForTests()
  clearAllBoards()
  clearAllMessages()
  mockPushContext.mockClear()
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lifecycle-test-'))
  state.userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lifecycle-db-'))
})

afterEach(async () => {
  await resetAppRuntimeForTests()
  await fs.rm(tmpDir, { recursive: true, force: true })
  await fs.rm(state.userDataDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------

describe('sub-agent lifecycle integration', () => {
  it('happy path: create → update status → add dependency → complete → verify unblocked', () => {
    // Create tasks
    const setup = createTask({ teamId: 'team', subject: 'Setup DB', description: 'Initialize' })
    const build = createTask({ teamId: 'team', subject: 'Build app', description: 'Compile' })
    const deploy = createTask({ teamId: 'team', subject: 'Deploy', description: 'Ship it' })

    // Build depends on setup
    const r1 = updateTask({ teamId: 'team', taskId: build.id, addBlockedBy: [setup.id] })
    assertTaskRecord(r1)
    expect(r1.blockedBy).toEqual([setup.id])

    // Deploy depends on build
    const r2 = updateTask({ teamId: 'team', taskId: deploy.id, addBlockedBy: [build.id] })
    assertTaskRecord(r2)
    expect(r2.blockedBy).toEqual([build.id])

    // Start and complete setup
    updateTask({ teamId: 'team', taskId: setup.id, status: 'in_progress' })
    updateTask({ teamId: 'team', taskId: setup.id, status: 'completed' })

    // Verify build's blocker is completed
    const setupTask = getTask('team', setup.id)
    expect(setupTask?.status).toBe('completed')

    // List tasks — blockedBy still references setup, but task listing can filter completed
    const tasks = listTasks('team')
    expect(tasks).toHaveLength(3)

    // Start and complete build
    updateTask({ teamId: 'team', taskId: build.id, status: 'in_progress' })
    updateTask({ teamId: 'team', taskId: build.id, status: 'completed' })

    // Deploy can now proceed
    const deployTask = getTask('team', deploy.id)
    expect(deployTask?.status).toBe('pending')
    const buildTask = getTask('team', build.id)
    expect(buildTask?.status).toBe('completed')
  })

  it('cycle detection: A blockedBy B, B blockedBy C, C blockedBy A → rejected', () => {
    const a = createTask({ teamId: 'team', subject: 'A', description: '' })
    const b = createTask({ teamId: 'team', subject: 'B', description: '' })
    const c = createTask({ teamId: 'team', subject: 'C', description: '' })

    // Valid chain: A → B → C
    const r1 = updateTask({ teamId: 'team', taskId: a.id, addBlockedBy: [b.id] })
    assertTaskRecord(r1)

    const r2 = updateTask({ teamId: 'team', taskId: b.id, addBlockedBy: [c.id] })
    assertTaskRecord(r2)

    // Attempt C → A: creates cycle
    const r3 = updateTask({ teamId: 'team', taskId: c.id, addBlockedBy: [a.id] })
    expect(r3).toEqual({
      kind: 'cycle_detected',
      detail: expect.stringContaining('dependency cycle'),
    })

    // Verify the valid chain is intact
    const aTask = getTask('team', a.id)
    const bTask = getTask('team', b.id)
    const cTask = getTask('team', c.id)
    expect(aTask?.blockedBy).toEqual([b.id])
    expect(bTask?.blockedBy).toEqual([c.id])
    expect(cTask?.blockedBy).toEqual([])
  })

  it('persistence round-trip: create → persist → clear → load → verify identical', async () => {
    const t1 = createTask({
      teamId: 'persist-team',
      subject: 'Task 1',
      description: 'First task',
      metadata: { priority: 'high' },
    })
    const t2 = createTask({
      teamId: 'persist-team',
      subject: 'Task 2',
      description: 'Second task',
    })
    updateTask({ teamId: 'persist-team', taskId: t2.id, addBlockedBy: [t1.id] })
    updateTask({ teamId: 'persist-team', taskId: t1.id, status: 'in_progress', owner: 'agent-a' })

    // Persist to disk
    await persistTaskBoard(tmpDir, 'persist-team')

    // Capture original state
    const originalTasks = listTasks('persist-team')

    // Clear in-memory and verify gone
    clearAllBoards()
    expect(listTasks('persist-team')).toEqual([])
    expect(isBoardLoaded('persist-team')).toBe(false)

    // Load from disk
    const loaded = await loadTaskBoard(tmpDir, 'persist-team')
    expect(loaded).toBe(true)
    expect(isBoardLoaded('persist-team')).toBe(true)

    // Verify identical
    const restoredTasks = listTasks('persist-team')
    expect(restoredTasks).toHaveLength(originalTasks.length)

    for (const orig of originalTasks) {
      const restored = restoredTasks.find((t) => t.id === orig.id)
      expect(restored).toBeDefined()
      expect(restored?.subject).toBe(orig.subject)
      expect(restored?.description).toBe(orig.description)
      expect(restored?.status).toBe(orig.status)
      expect(restored?.owner).toBe(orig.owner)
      expect(restored?.blockedBy).toEqual(orig.blockedBy)
      expect(restored?.metadata).toEqual(orig.metadata)
    }
  })

  it('message queuing: send to unsubscribed → verify pending → deliver → verify injected', () => {
    // Queue messages to an offline agent
    sendAgentMessage({
      type: 'message',
      sender: 'coordinator',
      recipient: 'worker',
      content: 'Please start task A',
    })
    sendAgentMessage({
      type: 'message',
      sender: 'coordinator',
      recipient: 'worker',
      content: 'Also check logs',
    })

    expect(getPendingMessageCount('worker')).toBe(2)

    // Deliver pending messages
    const convId = ConversationId('conv-123')
    const delivered = deliverPendingMessages('worker', convId)
    expect(delivered).toBe(2)

    // Verify injected via pushContext
    expect(mockPushContext).toHaveBeenCalledTimes(2)
    const firstCall = mockPushContext.mock.calls[0]
    expect(firstCall[0]).toBe(convId)
    expect(firstCall[1]).toContain('Please start task A')
    expect(firstCall[1]).toContain('<agent_message')

    const secondCall = mockPushContext.mock.calls[1]
    expect(secondCall[1]).toContain('Also check logs')

    // Pending cleared
    expect(getPendingMessageCount('worker')).toBe(0)
  })

  it('message persistence round-trip', async () => {
    // Queue messages
    sendAgentMessage({
      type: 'message',
      sender: 'lead',
      recipient: 'agent-1',
      content: 'Persisted message',
    })

    await persistPendingMessages(tmpDir, 'msg-team')
    clearAllMessages()

    expect(getPendingMessageCount('agent-1')).toBe(0)

    const loaded = await loadPendingMessages(tmpDir, 'msg-team')
    expect(loaded).toBe(true)
    expect(getPendingMessageCount('agent-1')).toBe(1)
  })
})
