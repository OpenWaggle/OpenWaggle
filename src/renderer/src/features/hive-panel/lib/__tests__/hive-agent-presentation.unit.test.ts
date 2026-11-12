import { SessionId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import type { HiveSession } from '@/queries/session-hive-contract'
import { hiveAgentCounts } from '../hive-agent-presentation'

function session(id: string, agent?: string, archived?: boolean) {
  return {
    id: SessionId(id),
    title: id,
    lineage: {
      role: id === 'root' ? 'queen' : 'worker',
      directWorkerCount: 0,
      activeDirectWorkerCount: 0,
      ...(agent ? { agentDefinitionName: agent } : {}),
    },
    ...(archived !== undefined ? { archived } : {}),
  } satisfies HiveSession
}

describe('hiveAgentCounts', () => {
  it('counts every loaded Session per definition, most used first, then by name', () => {
    expect(
      hiveAgentCounts(session('root', 'planner'), [
        session('a', 'reviewer'),
        session('b', 'reviewer', true),
        session('c'),
        session('d', 'implementer'),
      ]),
    ).toEqual([
      { name: 'reviewer', count: 2 },
      { name: 'implementer', count: 1 },
      { name: 'planner', count: 1 },
    ])
  })

  it('counts nothing for a Hive whose Sessions run no definition', () => {
    expect(hiveAgentCounts(null, [session('a'), session('b')])).toEqual([])
  })
})
