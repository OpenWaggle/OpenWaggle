import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionProjectionRepository } from '../../ports/session-projection-repository'
import {
  createSession,
  deleteSession,
  getSessionDetail,
  listSessionDetails,
  listSessionSummaries,
  listSessionWorktreeRefs,
  persistSessionSnapshot,
  updateSessionTitle,
} from '../session-details'
import { getSessionTree } from '../sessions'
import { runStoreEffect } from '../store-runtime'

const { state, getPathMock } = vi.hoisted(() => ({
  state: { userDataDir: '' },
  getPathMock: vi.fn(() => ''),
}))
getPathMock.mockImplementation(() => state.userDataDir)

vi.mock('electron', () => ({
  app: {
    getPath: getPathMock,
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}))

beforeEach(async () => {
  state.userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-session-store-'))
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
})

afterEach(async () => {
  const tmpDir = state.userDataDir
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('session-details integration basics', () => {
  it('persists and reloads sessions through the session projection tables', async () => {
    const session = await createSession({
      projectPath: '/tmp/project-a',
      piSessionId: 'pi-session-a',
      piSessionFile: '/tmp/pi-session-a.jsonl',
    })
    const saved = { ...session, title: 'Projected session' }

    await updateSessionTitle(saved.id, saved.title)
    await persistSessionSnapshot({
      sessionId: SessionId(String(saved.id)),
      piSessionId: 'pi-session-a',
      piSessionFile: '/tmp/pi-session-a.jsonl',
      activeNodeId: 'msg-2',
      nodes: [
        {
          id: 'msg-1',
          parentId: null,
          piEntryType: 'message',
          kind: 'user_message',
          role: 'user',
          timestampMs: 10,
          contentJson: JSON.stringify({
            parts: [{ type: 'text', text: 'hello pi' }],
            model: null,
          }),
          metadataJson: '{}',
          pathDepth: 0,
          createdOrder: 0,
        },
        {
          id: 'msg-2',
          parentId: 'msg-1',
          piEntryType: 'message',
          kind: 'assistant_message',
          role: 'assistant',
          timestampMs: 20,
          contentJson: JSON.stringify({
            parts: [{ type: 'text', text: 'hello back' }],
            model: 'openai/gpt-5.4',
          }),
          metadataJson: '{}',
          pathDepth: 1,
          createdOrder: 1,
        },
      ],
    })

    const reloaded = await getSessionDetail(saved.id)
    const summaries = await listSessionSummaries()
    const sessions = await listSessionDetails()
    const tree = await getSessionTree(SessionId(String(saved.id)))

    const expectReloadedMessages = () => {
      expect(reloaded?.title).toBe('Projected session')
      expect(reloaded?.messages).toHaveLength(2)
      expect(reloaded?.messages[1]?.parts[0]).toEqual({ type: 'text', text: 'hello back' })
    }
    const expectReloadedIndexes = () => {
      expect(summaries[0]?.id).toBe(saved.id)
      expect(summaries[0]?.messageCount).toBe(2)
      expect(sessions[0]?.id).toBe(saved.id)
      expect(tree?.branches[0]?.name).toBe('main')
      expect(tree?.nodes).toHaveLength(2)
    }

    expectReloadedMessages()
    expectReloadedIndexes()
  })

  it('keeps persisted messages isolated for concurrent sessions with identical prompts', async () => {
    const first = await createSession({
      projectPath: '/tmp/project-isolation-a',
      piSessionId: 'pi-session-isolation-a',
      piSessionFile: '/tmp/pi-session-isolation-a.jsonl',
    })
    const second = await createSession({
      projectPath: '/tmp/project-isolation-b',
      piSessionId: 'pi-session-isolation-b',
      piSessionFile: '/tmp/pi-session-isolation-b.jsonl',
    })
    const prompt = 'Draft a one-page summary of this app'

    await persistSessionSnapshot({
      sessionId: SessionId(String(first.id)),
      piSessionId: 'pi-session-isolation-a',
      piSessionFile: '/tmp/pi-session-isolation-a.jsonl',
      activeNodeId: 'assistant-a',
      nodes: [
        {
          id: 'user-a',
          parentId: null,
          piEntryType: 'message',
          kind: 'user_message',
          role: 'user',
          timestampMs: 10,
          contentJson: JSON.stringify({
            parts: [{ type: 'text', text: prompt }],
            model: null,
          }),
          metadataJson: '{}',
          pathDepth: 0,
          createdOrder: 0,
        },
        {
          id: 'assistant-a',
          parentId: 'user-a',
          piEntryType: 'message',
          kind: 'assistant_message',
          role: 'assistant',
          timestampMs: 20,
          contentJson: JSON.stringify({
            parts: [{ type: 'text', text: 'first session answer' }],
            model: 'openai/gpt-5.4',
          }),
          metadataJson: '{}',
          pathDepth: 1,
          createdOrder: 1,
        },
      ],
    })
    await persistSessionSnapshot({
      sessionId: SessionId(String(second.id)),
      piSessionId: 'pi-session-isolation-b',
      piSessionFile: '/tmp/pi-session-isolation-b.jsonl',
      activeNodeId: 'assistant-b',
      nodes: [
        {
          id: 'user-b',
          parentId: null,
          piEntryType: 'message',
          kind: 'user_message',
          role: 'user',
          timestampMs: 10,
          contentJson: JSON.stringify({
            parts: [{ type: 'text', text: prompt }],
            model: null,
          }),
          metadataJson: '{}',
          pathDepth: 0,
          createdOrder: 0,
        },
        {
          id: 'assistant-b',
          parentId: 'user-b',
          piEntryType: 'message',
          kind: 'assistant_message',
          role: 'assistant',
          timestampMs: 20,
          contentJson: JSON.stringify({
            parts: [{ type: 'text', text: 'second session answer' }],
            model: 'openai/gpt-5.4',
          }),
          metadataJson: '{}',
          pathDepth: 1,
          createdOrder: 1,
        },
      ],
    })

    const firstReloaded = await getSessionDetail(first.id)
    const secondReloaded = await getSessionDetail(second.id)

    expect(firstReloaded?.messages.map((message) => String(message.id))).toEqual([
      'user-a',
      'assistant-a',
    ])
    expect(secondReloaded?.messages.map((message) => String(message.id))).toEqual([
      'user-b',
      'assistant-b',
    ])
    expect(firstReloaded?.messages[1]?.parts).toEqual([
      { type: 'text', text: 'first session answer' },
    ])
    expect(secondReloaded?.messages[1]?.parts).toEqual([
      { type: 'text', text: 'second session answer' },
    ])
  })

  it('removes the Pi session file when deleting a session projection', async () => {
    await promisify(execFile)('git', ['init', state.userDataDir])
    const sessionFile = path.join(state.userDataDir, 'pi-session-delete.jsonl')
    await fs.writeFile(sessionFile, '{"type":"session_info"}\n', 'utf8')
    const session = await createSession({
      projectPath: state.userDataDir,
      piSessionId: 'pi-session-delete',
      piSessionFile: sessionFile,
    })

    const { runAppEffect } = await import('../../runtime')
    await runAppEffect(
      Effect.gen(function* () {
        const repository = yield* SessionProjectionRepository
        yield* repository.delete(session.id)
      }),
    )

    await expect(fs.stat(sessionFile)).rejects.toThrow()
    await expect(getSessionDetail(session.id)).resolves.toBeNull()
  })

  it('retains shared Workspace resources until their final Session binding is deleted', async () => {
    const first = await createSession({
      projectPath: '/tmp/project-shared',
      piSessionId: 'session-shared-first',
    })
    const second = await createSession({
      projectPath: '/tmp/project-shared',
      piSessionId: 'session-shared-second',
    })
    await runStoreEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO workspace_resources (
            id, project_path, kind, working_path, lifecycle_state,
            worktree_start_from_origin, created_at, updated_at
          ) VALUES (
            ${'workspace-shared'}, ${'/tmp/project-shared'}, ${'managed-worktree'},
            ${'/tmp/project-shared/.worktrees/shared'}, ${'ready'}, ${0}, ${1}, ${1}
          )
        `
        yield* sql`
          INSERT INTO session_workspace_bindings (session_id, workspace_id, bound_at)
          VALUES (${first.id}, ${'workspace-shared'}, ${1}),
                 (${second.id}, ${'workspace-shared'}, ${1})
        `
      }),
    )
    await expect(listSessionWorktreeRefs()).resolves.toEqual([
      {
        sessionId: first.id,
        worktreePath: '/tmp/project-shared/.worktrees/shared',
      },
      {
        sessionId: second.id,
        worktreePath: '/tmp/project-shared/.worktrees/shared',
      },
    ])

    await deleteSession(first.id)
    const afterFirstDelete = await runStoreEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* sql<{ readonly id: string }>`
          SELECT id FROM workspace_resources WHERE id = ${'workspace-shared'}
        `
      }),
    )
    expect(afterFirstDelete).toEqual([{ id: 'workspace-shared' }])

    await deleteSession(second.id)
    const afterLastDelete = await runStoreEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* sql<{ readonly id: string }>`
          SELECT id FROM workspace_resources WHERE id = ${'workspace-shared'}
        `
      }),
    )
    expect(afterLastDelete).toEqual([])
  })
})
