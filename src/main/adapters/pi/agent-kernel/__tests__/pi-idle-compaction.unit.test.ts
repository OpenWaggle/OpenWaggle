import type { AgentSession, PrecomputedCompaction } from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import { createIdleCacheWarming } from '../pi-idle-cache-warming'
import { IDLE_COMPACTION_LEAD_MS } from '../pi-idle-compaction'

/**
 * A Session left idle with a large context: shortly before its five-minute prompt cache entry
 * expires, the Host asks for the Portable handoff from the warm cache, and the next Run installs
 * it only if it starts after the entry expired.
 */

const TTL_MS = 300_000

function manualClock(start = 1_000_000) {
  let now = start
  const timers: Array<{ at: number; run: () => void; cancelled: boolean }> = []
  return {
    clock: {
      now: () => now,
      every: () => () => undefined,
      after: (ms: number, run: () => void) => {
        const timer = { at: now + ms, run, cancelled: false }
        timers.push(timer)
        return () => {
          timer.cancelled = true
        }
      },
    },
    async advance(ms: number) {
      now += ms
      for (const timer of timers.splice(0)) {
        if (timer.cancelled) continue
        if (timer.at <= now) timer.run()
        else timers.push(timer)
      }
      await new Promise((resolve) => setImmediate(resolve))
    },
    get now() {
      return now
    },
  }
}

const COMPACTION = fromPartial<PrecomputedCompaction>({
  summary: 'handoff',
  firstKeptEntryId: 'entry-2',
  anchorEntryId: 'entry-3',
})

function idlePiSession(sentAt: number, promptTokens: number) {
  return fromPartial<AgentSession>({
    cacheWarmingStatus: { state: 'inactive', reason: 'agent run settled' },
    idleCompactionCandidate: {
      sentAt,
      ttlMs: TTL_MS,
      promptTokens,
      model: { provider: 'amazon-bedrock', id: 'eu.anthropic.claude-opus-5-5' },
    },
    precomputeIdleCompaction: vi.fn(async () => COMPACTION),
    extensionRunner: { emit: vi.fn(async () => undefined) },
    dispose: vi.fn(),
    sessionManager: { appendUsage: vi.fn() },
  })
}

describe('idle compaction', () => {
  it('asks for the handoff a minute before the cache expires, then ends the Pi session', async () => {
    const time = manualClock()
    const warming = createIdleCacheWarming({ clock: time.clock })
    const session = idlePiSession(time.now, 250_000)

    await expect(warming.settle('session-a', session, { aborted: false })).resolves.toBe(
      'compacting',
    )
    await time.advance(TTL_MS - IDLE_COMPACTION_LEAD_MS - 1)
    expect(session.precomputeIdleCompaction).not.toHaveBeenCalled()
    await time.advance(1)

    expect(session.precomputeIdleCompaction).toHaveBeenCalledOnce()
    expect(session.dispose).toHaveBeenCalledOnce()
    expect(warming.borrow('session-a')).toBeUndefined()
    await warming.stop()
  })

  it('hands the next Run the handoff only once the cache it replaces has expired', async () => {
    const time = manualClock()
    const warming = createIdleCacheWarming({ clock: time.clock })
    await warming.settle('session-a', idlePiSession(time.now, 250_000), { aborted: false })
    await time.advance(TTL_MS - IDLE_COMPACTION_LEAD_MS)
    // The handoff request read the entry, which then lives for another five minutes.
    await time.advance(TTL_MS - 1)
    expect(warming.takeIdleCompaction('session-a')).toBeUndefined()

    await warming.settle('session-b', idlePiSession(time.now, 250_000), { aborted: false })
    await time.advance(TTL_MS - IDLE_COMPACTION_LEAD_MS)
    await time.advance(TTL_MS)
    expect(warming.takeIdleCompaction('session-b')).toBe(COMPACTION)
    expect(warming.takeIdleCompaction('session-b')).toBeUndefined()
    await warming.stop()
  })

  it('leaves a context under 200k tokens alone', async () => {
    const time = manualClock()
    const warming = createIdleCacheWarming({ clock: time.clock })
    const session = idlePiSession(time.now, 199_999)

    await expect(warming.settle('session-a', session, { aborted: false })).resolves.toBe('disposed')
    expect(session.precomputeIdleCompaction).not.toHaveBeenCalled()
  })

  it('computes nothing when the next Run starts first', async () => {
    const time = manualClock()
    const warming = createIdleCacheWarming({ clock: time.clock })
    const session = idlePiSession(time.now, 250_000)
    await warming.settle('session-a', session, { aborted: false })

    await warming.prepareRun('session-a')
    await time.advance(TTL_MS)

    expect(session.precomputeIdleCompaction).not.toHaveBeenCalled()
    expect(session.dispose).toHaveBeenCalledOnce()
    expect(warming.takeIdleCompaction('session-a')).toBeUndefined()
  })

  it('does nothing for an aborted Run, or when the cache is about to expire', async () => {
    const time = manualClock()
    const warming = createIdleCacheWarming({ clock: time.clock })

    await expect(
      warming.settle('session-a', idlePiSession(time.now, 250_000), { aborted: true }),
    ).resolves.toBe('disposed')
    await expect(
      warming.settle(
        'session-b',
        idlePiSession(time.now - (TTL_MS - IDLE_COMPACTION_LEAD_MS), 250_000),
        { aborted: false },
      ),
    ).resolves.toBe('disposed')
  })

  it.each(['off', 'idle'] as const)('does nothing when cache warming is %s', async (mode) => {
    const time = manualClock()
    const warming = createIdleCacheWarming({ clock: time.clock })
    warming.applyMode(mode)

    await expect(
      warming.settle('session-a', idlePiSession(time.now, 250_000), { aborted: false }),
    ).resolves.toBe('disposed')
  })

  it('drops a computed handoff when the Session is archived', async () => {
    const time = manualClock()
    const warming = createIdleCacheWarming({ clock: time.clock })
    await warming.settle('session-a', idlePiSession(time.now, 250_000), { aborted: false })
    await time.advance(TTL_MS - IDLE_COMPACTION_LEAD_MS)

    warming.closeSession('session-a')
    await time.advance(TTL_MS)

    expect(warming.takeIdleCompaction('session-a')).toBeUndefined()
  })
})
