import lifecycleFs from 'node:fs/promises'
import lifecycleOs from 'node:os'
import lifecyclePath from 'node:path'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type * as EventLoopSlice from '../../utils/event-loop-slice'

/** Reading many turns' changed files gives the Host's event loop turns between diffs (B5). */

const { state, getPathMock, slicer } = vi.hoisted(() => ({
  state: { userDataDir: '' },
  getPathMock: vi.fn(() => ''),
  slicer: { yields: 0 },
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

vi.mock('../../utils/event-loop-slice', async (importOriginal) => {
  const actual = await importOriginal<typeof EventLoopSlice>()
  return {
    ...actual,
    // Every yield point counts, whatever the time budget.
    makeEventLoopSlicer: () =>
      Effect.sync(() => {
        slicer.yields += 1
      }),
  }
})

const { createSession } = await import('../session-details')
const { listTurnDiffFiles, recordTurnCheckpoint } = await import('../turn-checkpoints')
const { resetAppRuntimeForTests } = await import('../../runtime')

beforeEach(async () => {
  state.userDataDir = await lifecycleFs.mkdtemp(
    lifecyclePath.join(lifecycleOs.tmpdir(), 'ow-turn-diff-slices-'),
  )
  slicer.yields = 0
  await resetAppRuntimeForTests()
})

afterEach(async () => {
  await resetAppRuntimeForTests()
  await lifecycleFs.rm(state.userDataDir, { recursive: true, force: true })
})

function largeDiff(file: string) {
  const added = Array.from({ length: 20_000 }, (_, index) => `+generated line ${String(index)}`)
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -0,0 +1,${String(added.length)} @@`,
    ...added,
    '',
  ].join('\n')
}

it('parses large turn diffs with an event-loop yield point after each one', async () => {
  const session = await createSession({
    projectPath: '/tmp/turn-diff-slices',
    piSessionId: 'pi-turn-diff-slices',
  })
  const sessionId = SessionId(String(session.id))
  const turnIds = Array.from({ length: 30 }, (_, index) => `turn-${String(index)}`)
  for (const turnId of turnIds) {
    await recordTurnCheckpoint({ sessionId, turnId, diff: largeDiff(`${turnId}.gen.ts`) })
  }

  const files = await listTurnDiffFiles(sessionId, turnIds)

  expect(Object.keys(files)).toHaveLength(30)
  expect(files['turn-29']).toEqual([{ path: 'turn-29.gen.ts', additions: 20_000, deletions: 0 }])
  expect(slicer.yields).toBeGreaterThanOrEqual(turnIds.length)
})
