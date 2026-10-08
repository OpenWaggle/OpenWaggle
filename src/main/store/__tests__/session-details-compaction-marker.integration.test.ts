import lifecycleFs from 'node:fs/promises'
import lifecycleOs from 'node:os'
import lifecyclePath from 'node:path'
import { SessionId } from '@shared/types/brand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectedSessionNodeInput } from '../../ports/session-repository'
import { createSession, getSessionDetail, persistSessionSnapshot } from '../session-details'
import { getSessionWorkspace } from '../sessions'

/*
 * A compaction's durable marker is its Pi `compaction` entry, which the transcript keeps where Pi
 * appended it, below the whole conversation before it (ADR 0048). It used to show only the model's
 * context, the compaction first: the "Context compacted" row that ended a manual compaction jumped
 * to the top of what was left, and every message the compaction summarized disappeared.
 */

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
    lifecyclePath.join(lifecycleOs.tmpdir(), 'ow-session-compaction-marker-'),
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

const PI_SESSION = { piSessionId: 'pi-compaction-marker', piSessionFile: '/tmp/pi-marker.jsonl' }

function messageNode(
  id: string,
  parentId: string | null,
  role: 'user' | 'assistant',
  createdOrder: number,
): ProjectedSessionNodeInput {
  return {
    id,
    parentId,
    piEntryType: 'message',
    kind: role === 'user' ? 'user_message' : 'assistant_message',
    role,
    timestampMs: createdOrder * 10,
    contentJson: JSON.stringify({ parts: [{ type: 'text', text: id }], model: null }),
    metadataJson: '{}',
    pathDepth: createdOrder,
    createdOrder,
  }
}

function compactionNode(
  id: string,
  parentId: string,
  firstKeptEntryId: string,
  createdOrder: number,
): ProjectedSessionNodeInput {
  return {
    id,
    parentId,
    piEntryType: 'compaction',
    kind: 'compaction_summary',
    role: null,
    timestampMs: createdOrder * 10,
    contentJson: JSON.stringify({
      summary: 'Checkpoint of the conversation so far.',
      firstKeptEntryId,
      tokensBefore: 4_200,
      fromHook: false,
      reason: 'manual',
    }),
    metadataJson: '{}',
    pathDepth: createdOrder,
    createdOrder,
  }
}

const HISTORY = [
  messageNode('user-1', null, 'user', 0),
  messageNode('assistant-1', 'user-1', 'assistant', 1),
  messageNode('user-2', 'assistant-1', 'user', 2),
  messageNode('assistant-2', 'user-2', 'assistant', 3),
]

async function transcriptAfterCompaction(input: {
  readonly firstKeptEntryId: string
  readonly laterNodes?: readonly ProjectedSessionNodeInput[]
}) {
  const session = await createSession({ projectPath: '/tmp/project-marker', ...PI_SESSION })
  const sessionId = SessionId(String(session.id))
  // The idle Session's earlier Runs, then the manual compaction's own snapshot.
  await persistSessionSnapshot({
    sessionId,
    ...PI_SESSION,
    activeNodeId: 'assistant-2',
    nodes: HISTORY,
  })
  const compaction = compactionNode('compaction-1', 'assistant-2', input.firstKeptEntryId, 4)
  const laterNodes = input.laterNodes ?? []
  await persistSessionSnapshot({
    sessionId,
    ...PI_SESSION,
    activeNodeId: laterNodes.at(-1)?.id ?? compaction.id,
    nodes: [...HISTORY, compaction, ...laterNodes],
  })
  const detail = await getSessionDetail(session.id)
  const workspace = await getSessionWorkspace(sessionId)
  return {
    detailIds: detail?.messages.map((message) => String(message.id)),
    workspaceIds: workspace?.transcriptPath.map((entry) => String(entry.node.id)),
    marker: detail?.messages.find((message) => String(message.id) === 'compaction-1')?.metadata,
  }
}

const ALL_HISTORY = HISTORY.map((node) => node.id)

describe('session-details compaction marker', () => {
  it('keeps the history a compaction summarized above its marker', async () => {
    const transcript = await transcriptAfterCompaction({ firstKeptEntryId: 'user-2' })

    const expected = [...ALL_HISTORY, 'compaction-1']
    expect(transcript.detailIds).toEqual(expected)
    expect(transcript.workspaceIds).toEqual(expected)
    expect(transcript.marker?.compactionSummary).toEqual({
      summary: 'Checkpoint of the conversation so far.',
      tokensBefore: 4_200,
      reason: 'manual',
    })
  })

  it('keeps the marker between the conversation before it and the next Run', async () => {
    const transcript = await transcriptAfterCompaction({
      firstKeptEntryId: 'user-2',
      laterNodes: [
        messageNode('user-3', 'compaction-1', 'user', 5),
        messageNode('assistant-3', 'user-3', 'assistant', 6),
      ],
    })

    const expected = [...ALL_HISTORY, 'compaction-1', 'user-3', 'assistant-3']
    expect(transcript.detailIds).toEqual(expected)
    expect(transcript.workspaceIds).toEqual(expected)
  })

  it('keeps the history before a Native checkpoint, which keeps no entry', async () => {
    const transcript = await transcriptAfterCompaction({
      firstKeptEntryId: 'native-replacement',
      laterNodes: [messageNode('user-3', 'compaction-1', 'user', 5)],
    })

    const expected = [...ALL_HISTORY, 'compaction-1', 'user-3']
    expect(transcript.detailIds).toEqual(expected)
    expect(transcript.workspaceIds).toEqual(expected)
  })

  it('keeps every marker of repeated compactions in place', async () => {
    const transcript = await transcriptAfterCompaction({
      firstKeptEntryId: 'user-2',
      laterNodes: [
        messageNode('user-3', 'compaction-1', 'user', 5),
        messageNode('assistant-3', 'user-3', 'assistant', 6),
        compactionNode('compaction-2', 'assistant-3', 'user-3', 7),
      ],
    })

    const expected = [...ALL_HISTORY, 'compaction-1', 'user-3', 'assistant-3', 'compaction-2']
    expect(transcript.detailIds).toEqual(expected)
    expect(transcript.workspaceIds).toEqual(expected)
  })
})
