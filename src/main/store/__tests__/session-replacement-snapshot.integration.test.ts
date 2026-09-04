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
  app: { getPath: getPathMock },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}))

function messageNode(input: {
  readonly id: string
  readonly parentId: string | null
  readonly role: 'assistant' | 'user'
  readonly text: string
  readonly order: number
}): ProjectedSessionNodeInput {
  return {
    id: input.id,
    parentId: input.parentId,
    piEntryType: 'message',
    kind: input.role === 'user' ? 'user_message' : 'assistant_message',
    role: input.role,
    timestampMs: input.order + 1,
    contentJson: JSON.stringify({
      parts: [{ type: 'text', text: input.text }],
      model: input.role === 'assistant' ? 'openai/gpt-5.4' : null,
    }),
    metadataJson: '{}',
    pathDepth: input.order,
    createdOrder: input.order,
  }
}

beforeEach(async () => {
  state.userDataDir = await lifecycleFs.mkdtemp(
    lifecyclePath.join(lifecycleOs.tmpdir(), 'ow-replacement-session-store-'),
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

describe('session replacement snapshot projection', () => {
  it('replays a disjoint replacement as the main active transcript after a runtime restart', async () => {
    const session = await createSession({
      projectPath: '/tmp/project-replacement',
      piSessionId: 'pi-session-replacement',
      piSessionFile: '/tmp/pi-session-replacement.jsonl',
    })
    const sessionId = SessionId(String(session.id))
    const snapshotIdentity = {
      sessionId,
      piSessionId: 'pi-session-replacement',
      piSessionFile: '/tmp/pi-session-replacement.jsonl',
    }

    await persistSessionSnapshot({
      ...snapshotIdentity,
      activeNodeId: 'old-assistant',
      nodes: [
        messageNode({ id: 'old-user', parentId: null, role: 'user', text: 'Old prompt', order: 0 }),
        messageNode({
          id: 'old-assistant',
          parentId: 'old-user',
          role: 'assistant',
          text: 'Old response',
          order: 1,
        }),
      ],
    })
    expect(
      (await getSessionTree(sessionId))?.branches.find((branch) => branch.isMain),
    ).toMatchObject({ headNodeId: 'old-assistant' })

    await persistSessionSnapshot({
      ...snapshotIdentity,
      activeNodeId: 'new-assistant',
      nodes: [
        messageNode({ id: 'new-user', parentId: null, role: 'user', text: 'New prompt', order: 0 }),
        messageNode({
          id: 'new-assistant',
          parentId: 'new-user',
          role: 'assistant',
          text: 'New response',
          order: 1,
        }),
      ],
    })

    const { resetAppRuntimeForTests } = await import('../../runtime')
    await resetAppRuntimeForTests()
    const tree = await getSessionTree(sessionId)
    const workspace = await getSessionWorkspace(sessionId)
    const detail = await getSessionDetail(sessionId)

    expect(tree?.session.lastActiveBranchId).toBe(`${sessionId}:main`)
    expect(tree?.branches.find((branch) => branch.isMain)).toMatchObject({
      headNodeId: 'new-assistant',
    })
    expect(String(workspace?.activeNodeId)).toBe('new-assistant')
    expect(workspace?.transcriptPath.map((entry) => String(entry.node.id))).toEqual([
      'new-user',
      'new-assistant',
    ])
    expect(detail?.messages.map((message) => String(message.id))).toEqual([
      'new-user',
      'new-assistant',
    ])
  })
})
