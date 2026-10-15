import { SessionId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import type { HiveSession } from '@/queries/session-hive-contract'
import { sessionsToolTarget, sessionsToolTargetId } from '../sessions-tool-target'

const LINEAGE = { directWorkerCount: 0, activeDirectWorkerCount: 0 }

const HIVE: readonly HiveSession[] = [
  { id: SessionId('q'), title: 'Queen work', lineage: { ...LINEAGE, role: 'queen' } },
  {
    id: SessionId('w1'),
    title: 'Review tool icons',
    lineage: { ...LINEAGE, role: 'worker', agentDefinitionName: 'reviewer' },
  },
]

function spawnResult(sessionId: string) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          contract: 'session-lifecycle-v2',
          response: { outcome: { sessionId } },
        }),
      },
    ],
    details: null,
  }
}

describe('sessionsToolTargetId', () => {
  it('reads the created Session from a spawn or launch result', () => {
    expect(sessionsToolTargetId({ action: 'spawn' }, spawnResult('w1'))).toBe('w1')
    expect(
      sessionsToolTargetId(
        { action: 'launch' },
        JSON.stringify({ response: { outcome: { sessionId: 'r' } } }),
      ),
    ).toBe('r')
    expect(sessionsToolTargetId({ action: 'spawn' }, undefined)).toBeNull()
    expect(sessionsToolTargetId({ action: 'spawn' }, 'not json')).toBeNull()
  })

  it('reads the target of other actions from their arguments', () => {
    expect(sessionsToolTargetId({ action: 'message', sessionId: 'w1' }, undefined)).toBe('w1')
    expect(
      sessionsToolTargetId(
        { action: 'report', target: { type: 'session', sessionId: 'w1' } },
        undefined,
      ),
    ).toBe('w1')
    expect(
      sessionsToolTargetId({ action: 'report', target: { type: 'queen' } }, undefined),
    ).toBeNull()
    expect(sessionsToolTargetId({ action: 'list' }, undefined)).toBeNull()
  })
})

describe('sessionsToolTarget', () => {
  it('describes a Hive member as the Hive panel does', () => {
    expect(sessionsToolTarget('w1', HIVE)).toEqual({
      title: 'Review tool icons',
      agentName: 'reviewer',
      isWorker: true,
    })
    expect(sessionsToolTarget('q', HIVE)).toEqual({
      title: 'Queen work',
      agentName: null,
      isWorker: false,
    })
    expect(sessionsToolTarget('gone', HIVE)).toBeNull()
    expect(sessionsToolTarget(null, HIVE)).toBeNull()
  })
})
