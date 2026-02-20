import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ConversationId, OrchestrationRunId, OrchestrationTaskId } from '@shared/types/brand'
import type { OrchestrationRunRecord } from '@shared/types/orchestration'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { state, getPathMock } = vi.hoisted(() => ({
  state: { userDataDir: '' },
  getPathMock: vi.fn(() => ''),
}))

getPathMock.mockImplementation(() => state.userDataDir)

vi.mock('electron', () => ({
  app: {
    getPath: getPathMock,
  },
}))

import { OrchestrationRunRepository } from './run-repository'

function makeRun(runId: string): OrchestrationRunRecord {
  return {
    runId: OrchestrationRunId(runId),
    conversationId: ConversationId('conversation-1'),
    status: 'running',
    startedAt: new Date().toISOString(),
    taskOrder: [OrchestrationTaskId('task-1')],
    tasks: {
      'task-1': {
        id: OrchestrationTaskId('task-1'),
        kind: 'analysis',
        status: 'running',
        dependsOn: [],
      },
    },
    outputs: {},
    fallbackUsed: false,
    updatedAt: Date.now(),
  }
}

describe('orchestration run repository', () => {
  beforeEach(async () => {
    state.userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openhive-orch-test-'))
  })

  afterEach(async () => {
    if (state.userDataDir) {
      await fs.rm(state.userDataDir, { recursive: true, force: true })
    }
  })

  it('saves and loads valid run ids', async () => {
    const repository = new OrchestrationRunRepository()
    await repository.save(makeRun('safe-run-1'))

    const loaded = await repository.get('safe-run-1')
    expect(loaded?.runId).toBe('safe-run-1')
  })

  it('rejects unsafe run ids and blocks path traversal reads', async () => {
    const repository = new OrchestrationRunRepository()
    await expect(repository.save(makeRun('../escape'))).rejects.toThrow('invalid run id')

    const conversationsDir = path.join(state.userDataDir, 'conversations')
    await fs.mkdir(conversationsDir, { recursive: true })
    await fs.writeFile(path.join(conversationsDir, 'secret.json'), '{"secret":true}', 'utf-8')

    const loaded = await repository.get('../conversations/secret')
    expect(loaded).toBeNull()
  })
})
