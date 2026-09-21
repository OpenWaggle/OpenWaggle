import { createHash } from 'node:crypto'
import type { AgentSession, SessionEntry } from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PiModel } from '../../pi-provider-catalog'
import { registerPiLiveRun, steerPiLiveRun } from '../pi-live-run-registry'
import { projectPiSessionSnapshot } from '../session-projection'

const TIMESTAMP = '2026-09-08T10:00:00.000Z'
function user(id: string, parentId: string | null, text: string): SessionEntry {
  return {
    id,
    parentId,
    timestamp: TIMESTAMP,
    type: 'message',
    message: { role: 'user', content: text, timestamp: 1 },
  }
}

describe('Pi authoritative steering boundary', () => {
  let unregister: (() => void) | undefined
  afterEach(() => unregister?.())

  it.each([false, true])(
    'captures order after compaction and before queueing, input hook=%s',
    async (routeThroughInputHook) => {
      let isCompacting = true
      const entries: SessionEntry[] = [user('prior', null, 'Prior context')]
      const getEntries = vi.fn(() => entries)
      const queueSteering = vi.fn(async () => {
        // Pi may append before its promise resolves; this entry must remain eligible.
        entries.push(user('actual-steer', 'transformed-original', 'continue'))
        return 'continue'
      })
      const model = fromPartial<PiModel>({ input: ['text'] })
      const session = fromPartial<AgentSession>({
        get isCompacting() {
          return isCompacting
        },
        isStreaming: true,
        model,
        sessionManager: { getEntries, getLeafId: () => entries.at(-1)?.id ?? null },
        steer: queueSteering,
        prompt: queueSteering,
      })
      unregister = registerPiLiveRun({ runId: 'run', session, model, routeThroughInputHook })
      const pending = steerPiLiveRun({ runId: 'run', text: 'continue', attachments: [] })
      await Promise.resolve()
      expect(getEntries).not.toHaveBeenCalled()
      expect(queueSteering).not.toHaveBeenCalled()

      entries.push({
        id: 'compaction',
        parentId: 'prior',
        timestamp: TIMESTAMP,
        type: 'compaction',
        summary: 'Prior context',
        firstKeptEntryId: 'prior',
        tokensBefore: 90000,
      })
      // The original /review prompt became "continue" while the steer was waiting.
      entries.push(user('transformed-original', 'compaction', 'continue'))
      isCompacting = false
      const result = await pending

      expect(result).toEqual({
        accepted: true,
        receipt: {
          delivery: 'queued',
          minimumCreatedOrder: 3,
          durableTextSha256: createHash('sha256').update('continue').digest('hex'),
        },
      })
      expect(queueSteering).toHaveBeenCalledOnce()
      const snapshot = projectPiSessionSnapshot(session)
      expect(
        snapshot.nodes
          .filter((node) => node.id === 'transformed-original' || node.id === 'actual-steer')
          .map((node) => ({ id: node.id, order: node.createdOrder })),
      ).toEqual([
        { id: 'transformed-original', order: 2 },
        { id: 'actual-steer', order: 3 },
      ])
    },
  )
})
