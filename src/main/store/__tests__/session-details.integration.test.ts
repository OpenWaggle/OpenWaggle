import lifecycleFs from 'node:fs/promises'
import fs from 'node:fs/promises'
import lifecycleOs from 'node:os'
import lifecyclePath from 'node:path'
import path from 'node:path'
import { SessionId } from '@shared/types/brand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createSession,
  deleteSession,
  getSessionDetail,
  listSessionDetails,
  listSessionSummaries,
  persistSessionSnapshot,
  updateSessionTitle,
} from '../session-details'
import { getSessionTree } from '../sessions'

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
  state.userDataDir = await lifecycleFs.mkdtemp(
    lifecyclePath.join(lifecycleOs.tmpdir(), 'ow-session-store-'),
  )
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
})

afterEach(async () => {
  const tmpDir = state.userDataDir
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
  await lifecycleFs.rm(tmpDir, { recursive: true, force: true })
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
    const sessionFile = path.join(state.userDataDir, 'pi-session-delete.jsonl')
    await fs.writeFile(sessionFile, '{"type":"session_info"}\n', 'utf8')
    const session = await createSession({
      projectPath: '/tmp/project-delete',
      piSessionId: 'pi-session-delete',
      piSessionFile: sessionFile,
    })

    await deleteSession(session.id)

    await expect(fs.stat(sessionFile)).rejects.toThrow()
    await expect(getSessionDetail(session.id)).resolves.toBeNull()
  })
})
