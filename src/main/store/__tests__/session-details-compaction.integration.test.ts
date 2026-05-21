import lifecycleFs from 'node:fs/promises'
import lifecycleOs from 'node:os'
import lifecyclePath from 'node:path'
import { SessionId } from '@shared/types/brand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSession, getSessionDetail, persistSessionSnapshot } from '../session-details'
import { getSessionWorkspace } from '../sessions'

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

describe('session-details compaction projection', () => {
  it('loads the active post-compaction working context instead of the pre-compaction history', async () => {
    const session = await createSession({
      projectPath: '/tmp/project-post-compaction-context',
      piSessionId: 'pi-session-post-compaction-context',
      piSessionFile: '/tmp/pi-session-post-compaction-context.jsonl',
    })
    const sessionId = SessionId(String(session.id))

    await persistSessionSnapshot({
      sessionId,
      piSessionId: 'pi-session-post-compaction-context',
      piSessionFile: '/tmp/pi-session-post-compaction-context.jsonl',
      activeNodeId: 'assistant-after-compaction',
      nodes: [
        {
          id: 'old-user',
          parentId: null,
          piEntryType: 'message',
          kind: 'user_message',
          role: 'user',
          timestampMs: 10,
          contentJson: JSON.stringify({
            parts: [{ type: 'text', text: 'old request that was summarized' }],
            model: null,
          }),
          metadataJson: '{}',
          pathDepth: 0,
          createdOrder: 0,
        },
        {
          id: 'old-assistant',
          parentId: 'old-user',
          piEntryType: 'message',
          kind: 'assistant_message',
          role: 'assistant',
          timestampMs: 20,
          contentJson: JSON.stringify({
            parts: [{ type: 'text', text: 'old answer that was summarized' }],
            model: 'openai/gpt-5.4',
          }),
          metadataJson: '{}',
          pathDepth: 1,
          createdOrder: 1,
        },
        {
          id: 'kept-user',
          parentId: 'old-assistant',
          piEntryType: 'message',
          kind: 'user_message',
          role: 'user',
          timestampMs: 30,
          contentJson: JSON.stringify({
            parts: [{ type: 'text', text: 'recent request kept after compaction' }],
            model: null,
          }),
          metadataJson: '{}',
          pathDepth: 2,
          createdOrder: 2,
        },
        {
          id: 'kept-assistant',
          parentId: 'kept-user',
          piEntryType: 'message',
          kind: 'assistant_message',
          role: 'assistant',
          timestampMs: 40,
          contentJson: JSON.stringify({
            parts: [{ type: 'text', text: 'recent answer kept after compaction' }],
            model: 'openai/gpt-5.4',
          }),
          metadataJson: '{}',
          pathDepth: 3,
          createdOrder: 3,
        },
        {
          id: 'compaction-summary',
          parentId: 'kept-assistant',
          piEntryType: 'compaction',
          kind: 'compaction_summary',
          role: null,
          timestampMs: 50,
          contentJson: JSON.stringify({
            summary: 'Summarized the old request and answer.',
            firstKeptEntryId: 'kept-user',
            tokensBefore: 123456,
          }),
          metadataJson: '{}',
          pathDepth: 4,
          createdOrder: 4,
        },
        {
          id: 'user-after-compaction',
          parentId: 'compaction-summary',
          piEntryType: 'message',
          kind: 'user_message',
          role: 'user',
          timestampMs: 60,
          contentJson: JSON.stringify({
            parts: [{ type: 'text', text: 'continue after compaction' }],
            model: null,
          }),
          metadataJson: '{}',
          pathDepth: 5,
          createdOrder: 5,
        },
        {
          id: 'assistant-after-compaction',
          parentId: 'user-after-compaction',
          piEntryType: 'message',
          kind: 'assistant_message',
          role: 'assistant',
          timestampMs: 70,
          contentJson: JSON.stringify({
            parts: [{ type: 'text', text: 'continued after compaction' }],
            model: 'openai/gpt-5.4',
          }),
          metadataJson: '{}',
          pathDepth: 6,
          createdOrder: 6,
        },
      ],
    })

    const reloaded = await getSessionDetail(session.id)
    const workspace = await getSessionWorkspace(sessionId)

    expect(reloaded?.messages.map((message) => String(message.id))).toEqual([
      'compaction-summary',
      'kept-user',
      'kept-assistant',
      'user-after-compaction',
      'assistant-after-compaction',
    ])
    expect(workspace?.transcriptPath.map((entry) => String(entry.node.id))).toEqual([
      'compaction-summary',
      'kept-user',
      'kept-assistant',
      'user-after-compaction',
      'assistant-after-compaction',
    ])
    expect(workspace?.transcriptPath[0]?.node.message?.metadata?.compactionSummary).toEqual({
      summary: 'Summarized the old request and answer.',
      tokensBefore: 123456,
    })
  })
})
