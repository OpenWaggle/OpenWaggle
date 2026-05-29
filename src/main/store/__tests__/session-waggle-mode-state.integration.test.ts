import lifecycleFs from 'node:fs/promises'
import lifecycleOs from 'node:os'
import lifecyclePath from 'node:path'
import { SessionId } from '@shared/types/brand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectedSessionNodeInput } from '../../ports/session-repository'
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

describe('session Waggle mode-state projection', () => {
  it('derives branch Waggle mode state from pi-waggle mode-state entries', async () => {
    const session = await createSession({
      projectPath: '/tmp/project-waggle-mode-state',
      piSessionId: 'pi-session-waggle-mode-state',
      piSessionFile: '/tmp/pi-session-waggle-mode-state.jsonl',
    })
    const sessionId = SessionId(String(session.id))
    const waggleConfig = {
      mode: 'sequential',
      agents: [
        {
          label: 'Architect',
          model: 'openai/gpt-5.4',
          roleDescription: 'Plans',
          color: 'blue',
        },
        {
          label: 'Reviewer',
          model: 'anthropic/claude-sonnet-4-5',
          roleDescription: 'Reviews',
          color: 'amber',
        },
      ],
      stop: { primary: 'consensus', maxTurnsSafety: 4 },
    }

    await persistSessionSnapshot({
      sessionId,
      piSessionId: 'pi-session-waggle-mode-state',
      piSessionFile: '/tmp/pi-session-waggle-mode-state.jsonl',
      activeNodeId: 'assistant-1',
      nodes: [
        {
          id: 'mode-state',
          parentId: null,
          piEntryType: 'custom',
          kind: 'custom',
          role: null,
          timestampMs: 5,
          contentJson: JSON.stringify({
            customType: 'pi-waggle.mode-state',
            data: {
              enabled: true,
              presetId: 'code-review',
              config: waggleConfig,
              updatedAt: 5,
            },
          }),
          metadataJson: '{}',
          pathDepth: 0,
          createdOrder: 0,
        },
        {
          id: 'user-1',
          parentId: 'mode-state',
          piEntryType: 'message',
          kind: 'user_message',
          role: 'user',
          timestampMs: 10,
          contentJson: JSON.stringify({
            parts: [{ type: 'text', text: 'Review this branch' }],
            model: null,
          }),
          metadataJson: '{}',
          pathDepth: 1,
          createdOrder: 1,
        },
        {
          id: 'assistant-1',
          parentId: 'user-1',
          piEntryType: 'message',
          kind: 'assistant_message',
          role: 'assistant',
          timestampMs: 20,
          contentJson: JSON.stringify({
            parts: [{ type: 'text', text: 'Review complete' }],
            model: 'openai/gpt-5.4',
          }),
          metadataJson: '{}',
          pathDepth: 2,
          createdOrder: 2,
        },
      ],
    })

    const tree = await getSessionTree(sessionId)
    const workspace = await getSessionWorkspace(sessionId)
    const branchState = workspace?.activeBranchState

    expect(tree?.nodes.map((node) => String(node.id))).toEqual(['user-1', 'assistant-1'])
    expect(branchState?.futureMode).toBe('waggle')
    expect(branchState?.waggleConfig?.agents[0]?.label).toBe('Architect')
    expect(String(branchState?.waggleConfig?.agents[0]?.model)).toBe('openai/gpt-5.4')
    expect(workspace?.transcriptPath.map((entry) => String(entry.node.id))).toEqual([
      'user-1',
      'assistant-1',
    ])
  })

  it('hydrates hidden disabled mode-state heads as visible branch heads and clears stale session config', async () => {
    const session = await createSession({
      projectPath: '/tmp/project-waggle-mode-state-disabled',
      piSessionId: 'pi-session-waggle-mode-state-disabled',
      piSessionFile: '/tmp/pi-session-waggle-mode-state-disabled.jsonl',
    })
    const sessionId = SessionId(String(session.id))
    const waggleConfig = {
      mode: 'sequential',
      agents: [
        {
          label: 'Architect',
          model: 'openai/gpt-5.4',
          roleDescription: 'Plans',
          color: 'blue',
        },
        {
          label: 'Reviewer',
          model: 'anthropic/claude-sonnet-4-5',
          roleDescription: 'Reviews',
          color: 'amber',
        },
      ],
      stop: { primary: 'consensus', maxTurnsSafety: 4 },
    }
    const visibleNodes = [
      {
        id: 'user-1',
        parentId: null,
        piEntryType: 'message',
        kind: 'user_message',
        role: 'user',
        timestampMs: 10,
        contentJson: JSON.stringify({
          parts: [{ type: 'text', text: 'Review this branch' }],
          model: null,
        }),
        metadataJson: '{}',
        pathDepth: 0,
        createdOrder: 0,
      },
      {
        id: 'assistant-1',
        parentId: 'user-1',
        piEntryType: 'message',
        kind: 'assistant_message',
        role: 'assistant',
        timestampMs: 20,
        contentJson: JSON.stringify({
          parts: [{ type: 'text', text: 'Review complete' }],
          model: 'openai/gpt-5.4',
        }),
        metadataJson: '{}',
        pathDepth: 1,
        createdOrder: 1,
      },
    ] satisfies readonly ProjectedSessionNodeInput[]

    await persistSessionSnapshot({
      sessionId,
      piSessionId: 'pi-session-waggle-mode-state-disabled',
      piSessionFile: '/tmp/pi-session-waggle-mode-state-disabled.jsonl',
      activeNodeId: 'mode-enabled',
      nodes: [
        ...visibleNodes,
        {
          id: 'mode-enabled',
          parentId: 'assistant-1',
          piEntryType: 'custom',
          kind: 'custom',
          role: null,
          timestampMs: 30,
          contentJson: JSON.stringify({
            customType: 'pi-waggle.mode-state',
            data: { enabled: true, config: waggleConfig, updatedAt: 30 },
          }),
          metadataJson: '{}',
          pathDepth: 2,
          createdOrder: 2,
        },
      ],
    })
    expect((await getSessionDetail(sessionId))?.waggleConfig?.agents[0]?.label).toBe('Architect')

    await persistSessionSnapshot({
      sessionId,
      piSessionId: 'pi-session-waggle-mode-state-disabled',
      piSessionFile: '/tmp/pi-session-waggle-mode-state-disabled.jsonl',
      activeNodeId: 'mode-disabled',
      nodes: [
        ...visibleNodes,
        {
          id: 'mode-disabled',
          parentId: 'assistant-1',
          piEntryType: 'custom',
          kind: 'custom',
          role: null,
          timestampMs: 40,
          contentJson: JSON.stringify({
            customType: 'pi-waggle.mode-state',
            data: { enabled: false, updatedAt: 40 },
          }),
          metadataJson: '{}',
          pathDepth: 2,
          createdOrder: 2,
        },
      ],
    })

    const tree = await getSessionTree(sessionId)
    const workspace = await getSessionWorkspace(sessionId)
    const detail = await getSessionDetail(sessionId)

    expect(tree?.nodes.map((node) => String(node.id))).toEqual(['user-1', 'assistant-1'])
    expect(tree?.branches.find((branch) => branch.isMain)?.headNodeId).toBe('assistant-1')
    expect(workspace?.activeBranchState?.futureMode).toBe('standard')
    expect(workspace?.activeBranchState?.waggleConfig).toBeUndefined()
    expect(detail?.waggleConfig).toBeUndefined()
  })
})
