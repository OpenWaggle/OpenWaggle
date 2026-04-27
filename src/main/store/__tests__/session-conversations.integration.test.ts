import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SessionBranchId, SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
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
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}))

import { resetAppRuntimeForTests, runAppEffect } from '../../runtime'
import {
  createConversation,
  getConversation,
  listConversations,
  persistSessionSnapshot,
  updateConversationTitle,
} from '../session-conversations'
import { getSessionTree, getSessionWorkspace, listSessions } from '../sessions'

describe('session-conversations integration', () => {
  let tmpDir = ''

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-session-store-'))
    state.userDataDir = tmpDir
    await resetAppRuntimeForTests()
  })

  afterEach(async () => {
    await resetAppRuntimeForTests()
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('persists and reloads conversations through the session projection tables', async () => {
    const conversation = await createConversation({
      projectPath: '/tmp/project-a',
      piSessionId: 'pi-session-a',
      piSessionFile: '/tmp/pi-session-a.jsonl',
    })
    const saved = { ...conversation, title: 'Projected session' }

    await updateConversationTitle(saved.id, saved.title)
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

    const reloaded = await getConversation(saved.id)
    const summaries = await listConversations()
    const sessions = await listSessions()
    const tree = await getSessionTree(SessionId(String(saved.id)))

    expect(reloaded?.title).toBe('Projected session')
    expect(reloaded?.messages).toHaveLength(2)
    expect(reloaded?.messages[1]?.parts[0]).toEqual({ type: 'text', text: 'hello back' })
    expect(summaries[0]?.id).toBe(saved.id)
    expect(summaries[0]?.messageCount).toBe(2)
    expect(sessions[0]?.id).toBe(saved.id)
    expect(tree?.branches[0]?.name).toBe('main')
    expect(tree?.nodes).toHaveLength(2)
  })

  it('renders visible Waggle custom requests while hiding internal Waggle turn prompts', async () => {
    const conversation = await createConversation({
      projectPath: '/tmp/project-waggle',
      piSessionId: 'pi-session-waggle',
      piSessionFile: '/tmp/pi-session-waggle.jsonl',
    })

    await persistSessionSnapshot({
      sessionId: SessionId(String(conversation.id)),
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
            customType: 'openwaggle.waggle.user_request',
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
            customType: 'openwaggle.waggle.turn',
            content: 'internal coordination prompt',
            display: false,
          }),
          metadataJson: JSON.stringify({
            customType: 'openwaggle.waggle.turn',
            display: false,
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

    const reloaded = await getConversation(conversation.id)
    const sessionId = SessionId(String(conversation.id))
    const tree = await getSessionTree(sessionId)
    const workspace = await getSessionWorkspace(sessionId)

    expect(reloaded?.messages.map((message) => message.role)).toEqual(['user', 'assistant'])
    expect(reloaded?.messages[0]?.parts).toMatchObject([
      { type: 'text', text: 'review this migration' },
    ])
    expect(reloaded?.messages[1]?.parts).toMatchObject([
      { type: 'text', text: 'migration review complete' },
    ])
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
  })

  it('hydrates tool results and structural Pi summaries as transcript messages', async () => {
    const conversation = await createConversation({
      projectPath: '/tmp/project-structural-transcript',
      piSessionId: 'pi-session-structural-transcript',
      piSessionFile: '/tmp/pi-session-structural-transcript.jsonl',
    })

    await persistSessionSnapshot({
      sessionId: SessionId(String(conversation.id)),
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

    const reloaded = await getConversation(conversation.id)

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

  it('loads the active post-compaction working context instead of the pre-compaction history', async () => {
    const conversation = await createConversation({
      projectPath: '/tmp/project-post-compaction-context',
      piSessionId: 'pi-session-post-compaction-context',
      piSessionFile: '/tmp/pi-session-post-compaction-context.jsonl',
    })
    const sessionId = SessionId(String(conversation.id))

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

    const reloaded = await getConversation(conversation.id)
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

  it('preserves stable branch identity and active branch state across Pi tree snapshots', async () => {
    const conversation = await createConversation({
      projectPath: '/tmp/project-branches',
      piSessionId: 'pi-session-branches',
      piSessionFile: '/tmp/pi-session-branches.jsonl',
    })
    const sessionId = SessionId(String(conversation.id))
    const mainBranchId = `${sessionId}:main`

    await persistSessionSnapshot({
      sessionId,
      piSessionId: 'pi-session-branches',
      piSessionFile: '/tmp/pi-session-branches.jsonl',
      activeNodeId: 'main-assistant-1',
      nodes: [
        {
          id: 'root-user',
          parentId: null,
          piEntryType: 'message',
          kind: 'user_message',
          role: 'user',
          timestampMs: 10,
          contentJson: JSON.stringify({
            parts: [{ type: 'text', text: 'Start migration plan' }],
            model: null,
          }),
          metadataJson: '{}',
          pathDepth: 0,
          createdOrder: 0,
        },
        {
          id: 'main-assistant-1',
          parentId: 'root-user',
          piEntryType: 'message',
          kind: 'assistant_message',
          role: 'assistant',
          timestampMs: 20,
          contentJson: JSON.stringify({
            parts: [{ type: 'text', text: 'Use the main path' }],
            model: 'openai/gpt-5.4',
          }),
          metadataJson: '{}',
          pathDepth: 1,
          createdOrder: 1,
        },
      ],
    })

    await runAppEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          UPDATE session_branch_state
          SET future_mode = ${'waggle'},
              waggle_config_json = ${'{"preserved":true}'},
              ui_state_json = ${'{"collapsed":false}'}
          WHERE branch_id = ${mainBranchId}
        `
      }),
    )

    await persistSessionSnapshot({
      sessionId,
      piSessionId: 'pi-session-branches',
      piSessionFile: '/tmp/pi-session-branches.jsonl',
      activeNodeId: 'branch-assistant',
      nodes: [
        {
          id: 'root-user',
          parentId: null,
          piEntryType: 'message',
          kind: 'user_message',
          role: 'user',
          timestampMs: 10,
          contentJson: JSON.stringify({
            parts: [{ type: 'text', text: 'Start migration plan' }],
            model: null,
          }),
          metadataJson: '{}',
          pathDepth: 0,
          createdOrder: 0,
        },
        {
          id: 'main-assistant-1',
          parentId: 'root-user',
          piEntryType: 'message',
          kind: 'assistant_message',
          role: 'assistant',
          timestampMs: 20,
          contentJson: JSON.stringify({
            parts: [{ type: 'text', text: 'Use the main path' }],
            model: 'openai/gpt-5.4',
          }),
          metadataJson: '{}',
          pathDepth: 1,
          createdOrder: 1,
        },
        {
          id: 'main-user-2',
          parentId: 'main-assistant-1',
          piEntryType: 'message',
          kind: 'user_message',
          role: 'user',
          timestampMs: 30,
          contentJson: JSON.stringify({
            parts: [{ type: 'text', text: 'Continue main path' }],
            model: null,
          }),
          metadataJson: '{}',
          pathDepth: 2,
          createdOrder: 2,
        },
        {
          id: 'main-assistant-2',
          parentId: 'main-user-2',
          piEntryType: 'message',
          kind: 'assistant_message',
          role: 'assistant',
          timestampMs: 40,
          contentJson: JSON.stringify({
            parts: [{ type: 'text', text: 'Main path continued' }],
            model: 'openai/gpt-5.4',
          }),
          metadataJson: '{}',
          pathDepth: 3,
          createdOrder: 3,
        },
        {
          id: 'branch-user',
          parentId: 'root-user',
          piEntryType: 'message',
          kind: 'user_message',
          role: 'user',
          timestampMs: 50,
          contentJson: JSON.stringify({
            parts: [{ type: 'text', text: 'Try branch path' }],
            model: null,
          }),
          metadataJson: '{}',
          pathDepth: 1,
          createdOrder: 4,
        },
        {
          id: 'branch-assistant',
          parentId: 'branch-user',
          piEntryType: 'message',
          kind: 'assistant_message',
          role: 'assistant',
          timestampMs: 60,
          contentJson: JSON.stringify({
            parts: [{ type: 'text', text: 'Branch path response' }],
            model: 'openai/gpt-5.4',
          }),
          metadataJson: '{}',
          pathDepth: 2,
          createdOrder: 5,
        },
      ],
    })

    const tree = await getSessionTree(sessionId)
    const mainWorkspace = await getSessionWorkspace(sessionId, {
      branchId: SessionBranchId(mainBranchId),
    })
    const activeWorkspace = await getSessionWorkspace(sessionId)
    const mainBranch = tree?.branches.find((branch) => branch.isMain)
    const activeBranch = tree?.branches.find(
      (branch) => branch.id === tree.session.lastActiveBranchId,
    )
    const mainState = tree?.branchStates.find((state) => state.branchId === mainBranch?.id)

    expect(mainBranch?.id).toBe(mainBranchId)
    expect(mainBranch?.headNodeId).toBe('main-assistant-2')
    expect(activeBranch?.id).toBe(`${sessionId}:branch:branch-user`)
    expect(activeBranch?.headNodeId).toBe('branch-assistant')
    expect(activeBranch?.isMain).toBe(false)
    expect(mainState?.futureMode).toBe('waggle')
    expect(mainState?.uiStateJson).toBe('{"collapsed":false}')
    expect(String(mainWorkspace?.activeBranchId)).toBe(mainBranchId)
    expect(String(mainWorkspace?.activeNodeId)).toBe('main-assistant-2')
    expect(mainWorkspace?.transcriptPath.map((entry) => String(entry.node.id))).toEqual([
      'root-user',
      'main-assistant-1',
      'main-user-2',
      'main-assistant-2',
    ])
    expect(String(activeWorkspace?.activeBranchId)).toBe(`${sessionId}:branch:branch-user`)
    expect(activeWorkspace?.transcriptPath.map((entry) => String(entry.node.id))).toEqual([
      'root-user',
      'branch-user',
      'branch-assistant',
    ])
  })
})
