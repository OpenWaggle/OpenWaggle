import lifecycleFs from 'node:fs/promises'
import lifecycleOs from 'node:os'
import lifecyclePath from 'node:path'
import { SessionId } from '@shared/types/brand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSession, getSessionDetail, persistSessionSnapshot } from '../session-details'
import { getSessionTree, getSessionWorkspace } from '../sessions'

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

describe('session-details transcript projection', () => {
  it('renders visible Waggle custom requests while hiding internal Waggle turn prompts', async () => {
    const session = await createSession({
      projectPath: '/tmp/project-waggle',
      piSessionId: 'pi-session-waggle',
      piSessionFile: '/tmp/pi-session-waggle.jsonl',
    })

    await persistSessionSnapshot({
      sessionId: SessionId(String(session.id)),
      piSessionId: 'pi-session-waggle',
      piSessionFile: '/tmp/pi-session-waggle.jsonl',
      activeNodeId: 'assistant-turn',
      nodes: [
        {
          id: 'visible-request',
          parentId: null,
          piEntryType: 'custom_message',
          kind: 'user_message',
          role: 'user',
          timestampMs: 10,
          contentJson: JSON.stringify({
            parts: [{ type: 'text', text: 'review this migration' }],
            model: null,
          }),
          metadataJson: JSON.stringify({
            customType: 'pi-waggle.user-request',
            display: true,
          }),
          pathDepth: 0,
          createdOrder: 0,
        },
        {
          id: 'hidden-turn',
          parentId: 'visible-request',
          piEntryType: 'custom_message',
          kind: 'custom',
          role: null,
          timestampMs: 20,
          contentJson: JSON.stringify({
            customType: 'pi-waggle.turn',
            content: 'internal coordination prompt',
            display: true,
          }),
          metadataJson: JSON.stringify({
            customType: 'pi-waggle.turn',
            display: true,
          }),
          pathDepth: 1,
          createdOrder: 1,
        },
        {
          id: 'assistant-turn',
          parentId: 'hidden-turn',
          piEntryType: 'message',
          kind: 'assistant_message',
          role: 'assistant',
          timestampMs: 30,
          contentJson: JSON.stringify({
            parts: [{ type: 'text', text: 'migration review complete' }],
            model: 'openai/gpt-5.4',
          }),
          metadataJson: '{}',
          pathDepth: 2,
          createdOrder: 2,
        },
      ],
    })

    const reloaded = await getSessionDetail(session.id)
    const sessionId = SessionId(String(session.id))
    const tree = await getSessionTree(sessionId)
    const workspace = await getSessionWorkspace(sessionId)

    const expectVisibleMessages = () => {
      expect(reloaded?.messages.map((message) => message.role)).toEqual(['user', 'assistant'])
      expect(reloaded?.messages[0]?.parts).toMatchObject([
        { type: 'text', text: 'review this migration' },
      ])
      expect(reloaded?.messages[1]?.parts).toMatchObject([
        { type: 'text', text: 'migration review complete' },
      ])
    }
    const expectVisibleTreePath = () => {
      expect(tree?.nodes.map((node) => String(node.id))).toEqual([
        'visible-request',
        'assistant-turn',
      ])
      expect(String(tree?.nodes[1]?.parentId)).toBe('visible-request')
      expect(workspace?.transcriptPath.map((entry) => String(entry.node.id))).toEqual([
        'visible-request',
        'assistant-turn',
      ])
      expect(String(workspace?.activeNodeId)).toBe('assistant-turn')
    }

    expectVisibleMessages()
    expectVisibleTreePath()
  })

  it('hydrates tool results and structural Pi summaries as transcript messages', async () => {
    const session = await createSession({
      projectPath: '/tmp/project-structural-transcript',
      piSessionId: 'pi-session-structural-transcript',
      piSessionFile: '/tmp/pi-session-structural-transcript.jsonl',
    })

    await persistSessionSnapshot({
      sessionId: SessionId(String(session.id)),
      piSessionId: 'pi-session-structural-transcript',
      piSessionFile: '/tmp/pi-session-structural-transcript.jsonl',
      activeNodeId: 'compaction-summary-1',
      nodes: [
        {
          id: 'user-1',
          parentId: null,
          piEntryType: 'message',
          kind: 'user_message',
          role: 'user',
          timestampMs: 10,
          contentJson: JSON.stringify({
            parts: [{ type: 'text', text: 'read package json' }],
            model: null,
          }),
          metadataJson: '{}',
          pathDepth: 0,
          createdOrder: 0,
        },
        {
          id: 'assistant-tool-call-1',
          parentId: 'user-1',
          piEntryType: 'message',
          kind: 'assistant_message',
          role: 'assistant',
          timestampMs: 20,
          contentJson: JSON.stringify({
            parts: [
              {
                type: 'tool-call',
                toolCall: {
                  id: 'tool-1',
                  name: 'read',
                  args: { filePath: 'package.json' },
                  state: 'input-complete',
                },
              },
            ],
            model: 'openai/gpt-5.4',
          }),
          metadataJson: '{}',
          pathDepth: 1,
          createdOrder: 1,
        },
        {
          id: 'tool-result-1',
          parentId: 'assistant-tool-call-1',
          piEntryType: 'message',
          kind: 'tool_result',
          role: null,
          timestampMs: 30,
          contentJson: JSON.stringify({
            parts: [
              {
                type: 'tool-result',
                toolResult: {
                  id: 'tool-1',
                  name: 'read',
                  args: { filePath: 'package.json' },
                  result: { content: [{ type: 'text', text: '{ "name": "openwaggle" }' }] },
                  isError: false,
                  duration: 4,
                },
              },
            ],
            model: null,
          }),
          metadataJson: '{}',
          pathDepth: 2,
          createdOrder: 2,
        },
        {
          id: 'branch-summary-1',
          parentId: 'tool-result-1',
          piEntryType: 'message',
          kind: 'branch_summary',
          role: null,
          timestampMs: 40,
          contentJson: JSON.stringify({ summary: 'Investigated package metadata.' }),
          metadataJson: '{}',
          pathDepth: 3,
          createdOrder: 3,
        },
        {
          id: 'compaction-summary-1',
          parentId: 'branch-summary-1',
          piEntryType: 'message',
          kind: 'compaction_summary',
          role: null,
          timestampMs: 50,
          contentJson: JSON.stringify({ summary: 'Condensed package metadata findings.' }),
          metadataJson: '{}',
          pathDepth: 4,
          createdOrder: 4,
        },
      ],
    })

    const reloaded = await getSessionDetail(session.id)

    expect(reloaded?.messages.map((message) => String(message.id))).toEqual([
      'user-1',
      'assistant-tool-call-1',
      'tool-result-1',
      'branch-summary-1',
      'compaction-summary-1',
    ])
    expect(reloaded?.messages[2]?.parts).toMatchObject([{ type: 'tool-result' }])
    expect(reloaded?.messages[3]?.parts).toEqual([
      { type: 'text', text: 'Branch summary\n\nInvestigated package metadata.' },
    ])
    expect(reloaded?.messages[4]?.parts).toEqual([
      { type: 'text', text: 'Compaction summary\n\nCondensed package metadata findings.' },
    ])
  })
})
