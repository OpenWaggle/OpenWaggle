import lifecycleFs from 'node:fs/promises'
import lifecycleOs from 'node:os'
import lifecyclePath from 'node:path'
import { SessionId } from '@shared/types/brand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSession } from '../session-details'
import {
  deleteTurnCheckpointsForSession,
  getTurnDiff,
  listTurnCheckpoints,
  pruneTurnCheckpoints,
  recordTurnCheckpoint,
  setTurnCheckpointAnchor,
} from '../turn-checkpoints'

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
    lifecyclePath.join(lifecycleOs.tmpdir(), 'ow-turn-checkpoints-'),
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

const DIFF_A = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -0,0 +1,1 @@
+alpha
`
const DIFF_B = `diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
@@ -1,1 +1,1 @@
+beta
-old
`

async function makeSession(suffix: string) {
  const session = await createSession({
    projectPath: `/tmp/turn-${suffix}`,
    piSessionId: `pi-turn-${suffix}`,
    piSessionFile: `/tmp/pi-turn-${suffix}.jsonl`,
  })
  return SessionId(String(session.id))
}

describe('turn checkpoints store', () => {
  it('records a checkpoint and computes the turn diff with parsed summary', async () => {
    const sessionId = await makeSession('record')
    await recordTurnCheckpoint({ sessionId, turnId: 'turn-1', diff: DIFF_B })

    const diff = await getTurnDiff(sessionId, 'turn-1')
    expect(diff).not.toBeNull()
    expect(diff?.insertions).toBe(1)
    expect(diff?.deletions).toBe(1)
    expect(diff?.files).toEqual([{ path: 'b.ts', additions: 1, deletions: 1 }])
  })

  it('lists checkpoints in capture (insertion) order', async () => {
    const sessionId = await makeSession('list')
    await recordTurnCheckpoint({ sessionId, turnId: 'turn-1', diff: DIFF_A })
    await recordTurnCheckpoint({ sessionId, turnId: 'turn-2', diff: DIFF_B })

    const summaries = await listTurnCheckpoints(sessionId)
    expect(summaries.map((s) => s.turnId)).toEqual(['turn-1', 'turn-2'])
    expect(summaries.map((s) => s.turnIndex)).toEqual([0, 1])
  })

  it('keeps strictly increasing turn_index across many turns (no collapse after retention)', async () => {
    const sessionId = await makeSession('idx')
    for (let i = 0; i < 5; i += 1) {
      await recordTurnCheckpoint({ sessionId, turnId: `t${String(i)}`, diff: DIFF_A })
    }
    const summaries = await listTurnCheckpoints(sessionId)
    expect(summaries.map((s) => s.turnIndex)).toEqual([0, 1, 2, 3, 4])
  })

  it('records and surfaces the transcript anchor node id', async () => {
    const sessionId = await makeSession('anchor')
    await recordTurnCheckpoint({ sessionId, turnId: 'turn-1', diff: DIFF_A })
    await setTurnCheckpointAnchor(sessionId, 'turn-1', 'node-42')
    const summaries = await listTurnCheckpoints(sessionId)
    expect(summaries[0]?.anchorNodeId).toBe('node-42')
  })

  it('prunes to the most recent N checkpoints (retention)', async () => {
    const sessionId = await makeSession('prune')
    await recordTurnCheckpoint({ sessionId, turnId: 't0', diff: DIFF_A })
    await recordTurnCheckpoint({ sessionId, turnId: 't1', diff: DIFF_A })
    await recordTurnCheckpoint({ sessionId, turnId: 't2', diff: DIFF_A })

    await pruneTurnCheckpoints(sessionId, 2)
    const summaries = await listTurnCheckpoints(sessionId)
    expect(summaries.map((s) => s.turnId)).toEqual(['t1', 't2'])
  })

  it('deletes all checkpoints for a session (retention on delete)', async () => {
    const sessionId = await makeSession('delete')
    await recordTurnCheckpoint({ sessionId, turnId: 't0', diff: DIFF_A })
    await deleteTurnCheckpointsForSession(sessionId)
    expect(await listTurnCheckpoints(sessionId)).toEqual([])
  })

  it('upserts a checkpoint for a repeated turn id', async () => {
    const sessionId = await makeSession('upsert')
    await recordTurnCheckpoint({ sessionId, turnId: 't0', diff: DIFF_A })
    await recordTurnCheckpoint({ sessionId, turnId: 't0', diff: DIFF_B })
    const summaries = await listTurnCheckpoints(sessionId)
    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toMatchObject({ turnId: 't0', insertions: 1, deletions: 1 })
  })
})
