import { SessionId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import type { HiveSession } from '@/queries/session-hive-contract'
import { findHiveSession, sessionsToolTarget, sessionsToolTargetId } from '../sessions-tool-target'

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
    expect(sessionsToolTargetId({ action: 'spawn' }, spawnResult('w1'), null)).toBe('w1')
    expect(
      sessionsToolTargetId(
        { action: 'launch' },
        JSON.stringify({ response: { outcome: { sessionId: 'r' } } }),
        null,
      ),
    ).toBe('r')
    expect(sessionsToolTargetId({ action: 'spawn' }, undefined, null)).toBeNull()
    expect(sessionsToolTargetId({ action: 'spawn' }, 'not json', null)).toBeNull()
  })

  it('reads a target the agent named by its Session link', () => {
    const link = 'openwaggle://sessions/w1'
    expect(sessionsToolTargetId({ action: 'read', sessionId: link }, undefined, null)).toBe('w1')
    expect(sessionsToolTargetId({ action: 'fork', sessionId: link }, undefined, 'caller')).toBe(
      'w1',
    )
    expect(
      sessionsToolTargetId(
        { action: 'report', target: { type: 'session', sessionId: link } },
        undefined,
        null,
      ),
    ).toBe('w1')
  })

  it('reads the target of other actions from their arguments', () => {
    expect(sessionsToolTargetId({ action: 'message', sessionId: 'w1' }, undefined, null)).toBe('w1')
    expect(
      sessionsToolTargetId(
        { action: 'report', target: { type: 'session', sessionId: 'w1' } },
        undefined,
        null,
      ),
    ).toBe('w1')
    expect(
      sessionsToolTargetId({ action: 'report', target: { type: 'queen' } }, undefined, null),
    ).toBeNull()
    expect(sessionsToolTargetId({ action: 'list' }, undefined, null)).toBeNull()
  })

  it('takes a fork without a sessionId as a fork of the calling Session', () => {
    expect(sessionsToolTargetId({ action: 'fork' }, undefined, 'q')).toBe('q')
    expect(sessionsToolTargetId({ action: 'fork', sessionId: 'w1' }, undefined, 'q')).toBe('w1')
  })
})

describe('sessionsToolTarget', () => {
  it('describes a Hive member as the Hive panel does', () => {
    expect(sessionsToolTarget(findHiveSession('w1', HIVE))).toEqual({
      title: 'Review tool icons',
      agentName: 'reviewer',
      isWorker: true,
    })
    expect(sessionsToolTarget(findHiveSession('q', HIVE))).toEqual({
      title: 'Queen work',
      agentName: null,
      isWorker: false,
    })
    expect(findHiveSession('gone', HIVE)).toBeNull()
    expect(sessionsToolTarget(findHiveSession(null, HIVE))).toBeNull()
  })
})
