import { describe, expect, it } from 'vitest'
import type { AgentCompactionStatus } from '../compaction-lifecycle'
import { areCopiesBlocked } from '../copies-blocked'

function compaction(phase: 'running' | 'completed'): AgentCompactionStatus {
  return {
    type: phase === 'running' ? 'compacting' : 'completed',
    reason: 'manual',
    summaryCountAtStart: 0,
    timeline: [
      { id: 'c1', phase, reason: 'manual', summaryCountAtStart: 0, messageCountAtStart: 2 },
    ],
  }
}

describe('areCopiesBlocked', () => {
  it.each([
    ['an idle Session', { isLoading: false, isFinishing: false, compactionStatus: null }, false],
    ['a running Session', { isLoading: true, isFinishing: false, compactionStatus: null }, true],
    [
      'a Run the Host is still settling',
      { isLoading: false, isFinishing: true, compactionStatus: null },
      true,
    ],
    [
      'a compaction in an idle Session',
      { isLoading: false, isFinishing: false, compactionStatus: compaction('running') },
      true,
    ],
    [
      'a finished compaction',
      { isLoading: false, isFinishing: false, compactionStatus: compaction('completed') },
      false,
    ],
  ])('blocks copies for %s: %s', (_, flags, blocked) => {
    expect(areCopiesBlocked(flags)).toBe(blocked)
  })
})
