import lifecycleFs from 'node:fs/promises'
import lifecycleOs from 'node:os'
import lifecyclePath from 'node:path'
import { OPENWAGGLE_AGENT_LOOP } from '@shared/constants/agent-loop'
import { SessionId } from '@shared/types/brand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSession, persistSessionSnapshot } from '../session-details'
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
    lifecyclePath.join(lifecycleOs.tmpdir(), 'ow-session-agent-loop-audit-'),
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

describe('session agent-loop audit projection', () => {
  it('keeps durable agent-loop audit events out of branch heads', async () => {
    const session = await createSession({
      projectPath: '/tmp/project-agent-loop-audit',
      piSessionId: 'pi-session-agent-loop-audit',
      piSessionFile: '/tmp/pi-session-agent-loop-audit.jsonl',
    })

    await persistSessionSnapshot({
      sessionId: SessionId(String(session.id)),
      piSessionId: 'pi-session-agent-loop-audit',
      piSessionFile: '/tmp/pi-session-agent-loop-audit.jsonl',
      activeNodeId: 'assistant-1',
      nodes: [
        {
          id: 'assistant-1',
          parentId: null,
          piEntryType: 'message',
          kind: 'assistant_message',
          role: 'assistant',
          timestampMs: 10,
          contentJson: JSON.stringify({
            parts: [{ type: 'text', text: 'Done' }],
            model: 'openai/gpt-5.4',
          }),
          metadataJson: '{}',
          pathDepth: 0,
          createdOrder: 0,
        },
        {
          id: 'run-1:agent-loop:0',
          parentId: 'assistant-1',
          piEntryType: 'custom',
          kind: 'custom',
          role: null,
          timestampMs: 20,
          contentJson: JSON.stringify({
            customType: OPENWAGGLE_AGENT_LOOP.SESSION_EVENT_CUSTOM_TYPE,
            event: {
              type: 'custom',
              timestamp: 20,
              name: 'openwaggle.github.issues.summary',
              value: { open: 2 },
            },
          }),
          metadataJson: JSON.stringify({
            customType: OPENWAGGLE_AGENT_LOOP.SESSION_EVENT_CUSTOM_TYPE,
          }),
          pathDepth: 1,
          createdOrder: 1,
        },
      ],
    })

    const sessionId = SessionId(String(session.id))
    const tree = await getSessionTree(sessionId)
    const workspace = await getSessionWorkspace(sessionId)

    expect(tree?.branches.map((branch) => String(branch.headNodeId))).toEqual(['assistant-1'])
    expect(tree?.nodes.map((node) => String(node.id))).toEqual([
      'assistant-1',
      'run-1:agent-loop:0',
    ])
    expect(workspace?.activeNodeId ? String(workspace.activeNodeId) : null).toBe('assistant-1')
    expect(workspace?.transcriptPath.map((entry) => String(entry.node.id))).toEqual(['assistant-1'])
  })
})
