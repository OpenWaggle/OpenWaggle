import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SessionBranchId, SessionId, SupportedModelId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { state, getPathMock } = vi.hoisted(() => ({
  state: { userDataDir: '' },
  getPathMock: vi.fn(() => ''),
}))
const BRANCH_CONTRACT_FUTURE_MODES: readonly ['standard', 'waggle'] = ['standard', 'waggle']

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

import type { ProjectedSessionNodeInput } from '../../ports/session-repository'
import { resetAppRuntimeForTests, runAppEffect } from '../../runtime'
import {
  createSession,
  getSessionDetail,
  listSessionDetails,
  listSessionSummaries,
  persistSessionSnapshot,
  updateSessionTitle,
} from '../session-details'
import {
  archiveSessionBranch,
  getSessionTree,
  getSessionWorkspace,
  listArchivedSessionBranches,
  listSessions,
  renameSessionBranch,
  restoreSessionBranch,
  updateSessionTreeUiState,
} from '../sessions'

describe('session-details integration', () => {
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

    const reloaded = await getSessionDetail(session.id)
    const sessionId = SessionId(String(session.id))
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

  it('preserves stable branch identity and active branch state across Pi tree snapshots', async () => {
    const session = await createSession({
      projectPath: '/tmp/project-branches',
      piSessionId: 'pi-session-branches',
      piSessionFile: '/tmp/pi-session-branches.jsonl',
    })
    const sessionId = SessionId(String(session.id))
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

  it.each(
    BRANCH_CONTRACT_FUTURE_MODES,
  )('preserves %s branch future-mode state across Pi reprojection', async (futureMode) => {
    const session = await createSession({
      projectPath: `/tmp/project-${futureMode}-branch-contract`,
      piSessionId: `pi-session-${futureMode}-branch-contract`,
      piSessionFile: `/tmp/pi-session-${futureMode}-branch-contract.jsonl`,
    })
    const sessionId = SessionId(String(session.id))
    const mainBranchId = `${sessionId}:main`
    const nodes: ProjectedSessionNodeInput[] = [
      {
        id: 'root-user',
        parentId: null,
        piEntryType: 'message',
        kind: 'user_message',
        role: 'user',
        timestampMs: 10,
        contentJson: JSON.stringify({
          parts: [{ type: 'text', text: 'Start' }],
          model: null,
        }),
        metadataJson: '{}',
        pathDepth: 0,
        createdOrder: 0,
      },
      {
        id: 'assistant-1',
        parentId: 'root-user',
        piEntryType: 'message',
        kind: 'assistant_message',
        role: 'assistant',
        timestampMs: 20,
        contentJson: JSON.stringify({
          parts: [{ type: 'text', text: 'Continue' }],
          model: 'openai/gpt-5.4',
        }),
        metadataJson: '{}',
        pathDepth: 1,
        createdOrder: 1,
      },
    ]

    await persistSessionSnapshot({
      sessionId,
      piSessionId: `pi-session-${futureMode}-branch-contract`,
      piSessionFile: `/tmp/pi-session-${futureMode}-branch-contract.jsonl`,
      activeNodeId: 'assistant-1',
      nodes,
    })

    await runAppEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
            UPDATE session_branch_state
            SET future_mode = ${futureMode},
                ui_state_json = ${`{"mode":"${futureMode}"}`}
            WHERE branch_id = ${mainBranchId}
          `
      }),
    )

    await persistSessionSnapshot({
      sessionId,
      piSessionId: `pi-session-${futureMode}-branch-contract`,
      piSessionFile: `/tmp/pi-session-${futureMode}-branch-contract.jsonl`,
      activeNodeId: 'assistant-1',
      nodes,
    })

    const tree = await getSessionTree(sessionId)
    const branchState = tree?.branchStates.find((state) => String(state.branchId) === mainBranchId)

    expect(branchState?.futureMode).toBe(futureMode)
    expect(branchState?.uiStateJson).toBe(`{"mode":"${futureMode}"}`)
  })

  it('preserves interrupted run indicators across Pi reprojection', async () => {
    const session = await createSession({
      projectPath: '/tmp/project-interrupted-run',
      piSessionId: 'pi-session-interrupted-run',
      piSessionFile: '/tmp/pi-session-interrupted-run.jsonl',
    })
    const sessionId = SessionId(String(session.id))
    const branchId = SessionBranchId(`${sessionId}:main`)
    const nodes: ProjectedSessionNodeInput[] = [
      {
        id: 'root-user',
        parentId: null,
        piEntryType: 'message',
        kind: 'user_message',
        role: 'user',
        timestampMs: 10,
        contentJson: JSON.stringify({
          parts: [{ type: 'text', text: 'Start' }],
          model: null,
        }),
        metadataJson: '{}',
        pathDepth: 0,
        createdOrder: 0,
      },
      {
        id: 'assistant-1',
        parentId: 'root-user',
        piEntryType: 'message',
        kind: 'assistant_message',
        role: 'assistant',
        timestampMs: 20,
        contentJson: JSON.stringify({
          parts: [{ type: 'text', text: 'Continue' }],
          model: 'openai/gpt-5.4',
        }),
        metadataJson: '{}',
        pathDepth: 1,
        createdOrder: 1,
      },
    ]

    await persistSessionSnapshot({
      sessionId,
      piSessionId: 'pi-session-interrupted-run',
      piSessionFile: '/tmp/pi-session-interrupted-run.jsonl',
      activeNodeId: 'assistant-1',
      nodes,
    })

    await runAppEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO session_active_runs (
            run_id,
            session_id,
            branch_id,
            run_mode,
            status,
            runtime_json,
            updated_at
          )
          VALUES (
            ${'run-interrupted-1'},
            ${sessionId},
            ${branchId},
            ${'classic'},
            ${'interrupted'},
            ${JSON.stringify({ model: 'openai/gpt-5.4' })},
            ${100}
          )
        `
      }),
    )

    await persistSessionSnapshot({
      sessionId,
      piSessionId: 'pi-session-interrupted-run',
      piSessionFile: '/tmp/pi-session-interrupted-run.jsonl',
      activeNodeId: 'assistant-1',
      nodes,
    })

    const tree = await getSessionTree(sessionId)
    const sessions = await listSessions()
    const treeMainBranch = tree?.branches.find((branch) => branch.id === branchId)
    const listMainBranch = sessions[0]?.branches?.find((branch) => branch.id === branchId)

    expect(treeMainBranch?.interruptedRun).toEqual({
      runId: 'run-interrupted-1',
      sessionId,
      branchId,
      runMode: 'classic',
      model: SupportedModelId('openai/gpt-5.4'),
      interruptedAt: 100,
    })
    expect(listMainBranch?.interruptedRun?.runId).toBe('run-interrupted-1')
  })

  it('archives a branch without deleting it from the session tree projection', async () => {
    const session = await createSession({
      projectPath: '/tmp/project-archived-branch',
      piSessionId: 'pi-session-archived-branch',
      piSessionFile: '/tmp/pi-session-archived-branch.jsonl',
    })
    const sessionId = SessionId(String(session.id))
    const branchId = SessionBranchId(`${sessionId}:branch:branch-user`)
    const nodes: ProjectedSessionNodeInput[] = [
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
        id: 'main-assistant',
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
        id: 'branch-user',
        parentId: 'root-user',
        piEntryType: 'message',
        kind: 'user_message',
        role: 'user',
        timestampMs: 30,
        contentJson: JSON.stringify({
          parts: [{ type: 'text', text: 'Try branch path' }],
          model: null,
        }),
        metadataJson: '{}',
        pathDepth: 1,
        createdOrder: 2,
      },
      {
        id: 'branch-assistant',
        parentId: 'branch-user',
        piEntryType: 'message',
        kind: 'assistant_message',
        role: 'assistant',
        timestampMs: 40,
        contentJson: JSON.stringify({
          parts: [{ type: 'text', text: 'Branch path response' }],
          model: 'openai/gpt-5.4',
        }),
        metadataJson: '{}',
        pathDepth: 2,
        createdOrder: 3,
      },
    ]

    await persistSessionSnapshot({
      sessionId,
      piSessionId: 'pi-session-archived-branch',
      piSessionFile: '/tmp/pi-session-archived-branch.jsonl',
      activeNodeId: 'branch-assistant',
      nodes,
    })

    await archiveSessionBranch(sessionId, branchId)

    const archivedTree = await getSessionTree(sessionId)
    const archivedBranch = archivedTree?.branches.find((branch) => branch.id === branchId)
    const sessionSummary = (await listSessions()).find((session) => session.id === sessionId)

    expect(archivedTree?.branches).toHaveLength(2)
    expect(archivedBranch?.archived).toBe(true)
    expect(String(archivedTree?.session.lastActiveBranchId)).toBe(`${sessionId}:main`)
    expect(sessionSummary?.branches?.map((branch) => branch.name)).toEqual(['main'])

    const archivedBranchSummaries = await listArchivedSessionBranches()
    const archivedBranchSummary = archivedBranchSummaries.find(
      (session) => session.id === sessionId,
    )
    expect(archivedBranchSummary?.projectPath).toBe('/tmp/project-archived-branch')
    expect(archivedBranchSummary?.branches?.map((branch) => branch.name)).toEqual([
      'Start migration plan',
    ])

    await persistSessionSnapshot({
      sessionId,
      piSessionId: 'pi-session-archived-branch',
      piSessionFile: '/tmp/pi-session-archived-branch.jsonl',
      activeNodeId: 'branch-assistant',
      nodes,
    })

    const refreshedTree = await getSessionTree(sessionId)
    const refreshedBranch = refreshedTree?.branches.find((branch) => branch.id === branchId)

    expect(refreshedTree?.branches).toHaveLength(2)
    expect(refreshedBranch?.archived).toBe(true)
    expect(String(refreshedTree?.session.lastActiveBranchId)).toBe(`${sessionId}:main`)
    expect(String(refreshedTree?.session.lastActiveNodeId)).toBe('main-assistant')
  })

  it('restores an archived branch without selecting it automatically', async () => {
    const session = await createSession({
      projectPath: '/tmp/project-restored-branch',
      piSessionId: 'pi-session-restored-branch',
      piSessionFile: '/tmp/pi-session-restored-branch.jsonl',
    })
    const sessionId = SessionId(String(session.id))
    const branchId = SessionBranchId(`${sessionId}:branch:branch-user`)

    await persistSessionSnapshot({
      sessionId,
      piSessionId: 'pi-session-restored-branch',
      piSessionFile: '/tmp/pi-session-restored-branch.jsonl',
      activeNodeId: 'main-assistant',
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
          id: 'main-assistant',
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
          id: 'branch-user',
          parentId: 'root-user',
          piEntryType: 'message',
          kind: 'user_message',
          role: 'user',
          timestampMs: 30,
          contentJson: JSON.stringify({
            parts: [{ type: 'text', text: 'Try branch path' }],
            model: null,
          }),
          metadataJson: '{}',
          pathDepth: 1,
          createdOrder: 2,
        },
        {
          id: 'branch-assistant',
          parentId: 'branch-user',
          piEntryType: 'message',
          kind: 'assistant_message',
          role: 'assistant',
          timestampMs: 40,
          contentJson: JSON.stringify({
            parts: [{ type: 'text', text: 'Branch path response' }],
            model: 'openai/gpt-5.4',
          }),
          metadataJson: '{}',
          pathDepth: 2,
          createdOrder: 3,
        },
      ],
    })

    await archiveSessionBranch(sessionId, branchId)
    await restoreSessionBranch(sessionId, branchId)

    const restoredTree = await getSessionTree(sessionId)
    const restoredBranch = restoredTree?.branches.find((branch) => branch.id === branchId)

    expect(restoredBranch?.archived).toBeUndefined()
    expect(restoredBranch?.archivedAt).toBeNull()
    expect(String(restoredTree?.session.lastActiveBranchId)).toBe(`${sessionId}:main`)
  })

  it('rejects branch mutations for main or missing branches', async () => {
    const session = await createSession({
      projectPath: '/tmp/project-branch-mutation-validation',
      piSessionId: 'pi-session-branch-mutation-validation',
      piSessionFile: '/tmp/pi-session-branch-mutation-validation.jsonl',
    })
    const sessionId = SessionId(String(session.id))

    await persistSessionSnapshot({
      sessionId,
      piSessionId: 'pi-session-branch-mutation-validation',
      piSessionFile: '/tmp/pi-session-branch-mutation-validation.jsonl',
      activeNodeId: null,
      nodes: [],
    })

    await expect(
      archiveSessionBranch(sessionId, SessionBranchId(`${sessionId}:main`)),
    ).rejects.toThrow('Session branch not found or cannot be modified.')
    await expect(
      renameSessionBranch(sessionId, SessionBranchId(`${sessionId}:missing`), 'Missing'),
    ).rejects.toThrow('Session branch not found or cannot be modified.')
    await expect(
      restoreSessionBranch(sessionId, SessionBranchId(`${sessionId}:missing`)),
    ).rejects.toThrow('Session branch not found or cannot be modified.')
  })

  it('renames a non-main branch and preserves the custom name across snapshots', async () => {
    const session = await createSession({
      projectPath: '/tmp/project-renamed-branch',
      piSessionId: 'pi-session-renamed-branch',
      piSessionFile: '/tmp/pi-session-renamed-branch.jsonl',
    })
    const sessionId = SessionId(String(session.id))
    const branchId = SessionBranchId(`${sessionId}:branch:branch-user`)
    const nodes: ProjectedSessionNodeInput[] = [
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
        id: 'main-assistant',
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
        id: 'branch-user',
        parentId: 'root-user',
        piEntryType: 'message',
        kind: 'user_message',
        role: 'user',
        timestampMs: 30,
        contentJson: JSON.stringify({
          parts: [{ type: 'text', text: 'Try branch path' }],
          model: null,
        }),
        metadataJson: '{}',
        pathDepth: 1,
        createdOrder: 2,
      },
      {
        id: 'branch-assistant',
        parentId: 'branch-user',
        piEntryType: 'message',
        kind: 'assistant_message',
        role: 'assistant',
        timestampMs: 40,
        contentJson: JSON.stringify({
          parts: [{ type: 'text', text: 'Branch path response' }],
          model: 'openai/gpt-5.4',
        }),
        metadataJson: '{}',
        pathDepth: 2,
        createdOrder: 3,
      },
    ]

    await persistSessionSnapshot({
      sessionId,
      piSessionId: 'pi-session-renamed-branch',
      piSessionFile: '/tmp/pi-session-renamed-branch.jsonl',
      activeNodeId: 'branch-assistant',
      nodes,
    })

    await renameSessionBranch(sessionId, branchId, 'OAuth retry path')

    const renamedTree = await getSessionTree(sessionId)
    const renamedBranch = renamedTree?.branches.find((branch) => branch.id === branchId)

    expect(renamedBranch?.name).toBe('OAuth retry path')

    await persistSessionSnapshot({
      sessionId,
      piSessionId: 'pi-session-renamed-branch',
      piSessionFile: '/tmp/pi-session-renamed-branch.jsonl',
      activeNodeId: 'branch-assistant',
      nodes,
    })

    const refreshedTree = await getSessionTree(sessionId)
    const refreshedBranch = refreshedTree?.branches.find((branch) => branch.id === branchId)

    expect(refreshedBranch?.name).toBe('OAuth retry path')
  })

  it('persists branch-list collapse state for session navigation summaries', async () => {
    const session = await createSession({
      projectPath: '/tmp/project-tree-ui-state',
      piSessionId: 'pi-session-tree-ui-state',
      piSessionFile: '/tmp/pi-session-tree-ui-state.jsonl',
    })
    const sessionId = SessionId(String(session.id))

    await updateSessionTreeUiState(sessionId, { branchesSidebarCollapsed: true })

    const summary = (await listSessions()).find((session) => session.id === sessionId)
    const tree = await getSessionTree(sessionId)

    expect(summary?.treeUiState?.branchesSidebarCollapsed).toBe(true)
    expect(tree?.uiState?.branchesSidebarCollapsed).toBe(true)
  })
})
