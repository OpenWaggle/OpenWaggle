import lifecycleFs from 'node:fs/promises'
import lifecycleOs from 'node:os'
import lifecyclePath from 'node:path'
import { SessionId } from '@shared/types/brand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSession, persistSessionSnapshot } from '../../session-details'
import { getSessionResourceProjectionNodes } from '../session-resource-projection'

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

beforeEach(async () => {
  state.userDataDir = await lifecycleFs.mkdtemp(
    lifecyclePath.join(lifecycleOs.tmpdir(), 'ow-resource-projection-'),
  )
  const { resetAppRuntimeForTests } = await import('../../../runtime')
  await resetAppRuntimeForTests()
})

afterEach(async () => {
  const temporaryDirectory = state.userDataDir
  const { resetAppRuntimeForTests } = await import('../../../runtime')
  await resetAppRuntimeForTests()
  await lifecycleFs.rm(temporaryDirectory, { recursive: true, force: true })
})

describe('session resource projection lookup', () => {
  it('hydrates only the requested session nodes in created order', async () => {
    const session = await createSession({
      projectPath: '/tmp/project-resource-projection',
      piSessionId: 'pi-session-resource-projection',
      piSessionFile: '/tmp/pi-session-resource-projection.jsonl',
    })
    const sessionId = SessionId(String(session.id))
    await persistSessionSnapshot({
      sessionId,
      piSessionId: 'pi-session-resource-projection',
      piSessionFile: '/tmp/pi-session-resource-projection.jsonl',
      activeNodeId: 'node-three',
      nodes: ['one', 'two', 'three'].map((label, index) => ({
        id: `node-${label}`,
        parentId: index === 0 ? null : `node-${['one', 'two'][index - 1]}`,
        piEntryType: 'message',
        kind: 'user_message' as const,
        role: 'user' as const,
        timestampMs: index + 1,
        contentJson: JSON.stringify({ parts: [{ type: 'text', text: label }], model: null }),
        metadataJson: '{}',
        pathDepth: index,
        createdOrder: index,
      })),
    })

    const nodes = await getSessionResourceProjectionNodes(sessionId, [
      'node-three',
      'missing-node',
      'node-one',
    ])

    expect(nodes.map(({ id }) => String(id))).toEqual(['node-one', 'node-three'])
  })
})
