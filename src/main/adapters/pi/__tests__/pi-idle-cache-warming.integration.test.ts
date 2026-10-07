import { fauxAssistantMessage } from '@earendil-works/pi-ai'
import type { AgentSession, ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, describe, expect, it } from 'vitest'
import { createIdleCacheWarming, idleCacheWarming } from '../agent-kernel/pi-idle-cache-warming'
import { getPiContextUsage } from '../agent-kernel/session-operations'
import {
  cleanupOpenWagglePiSessions,
  createOpenWagglePiSession,
} from './openwaggle-pi-session.test-support'

afterEach(cleanupOpenWagglePiSessions)

/** The faux prompt is far too small for Pi's savings threshold, so the test asks Pi to warm anyway. */
function alwaysWarm(pi: ExtensionAPI) {
  pi.on('cache_warming_decision', () => ({ action: 'warm' }))
}

/** An 11-second cache lifetime makes Pi refresh it one second after the request that wrote it. */
const PROMPT_CACHE_SECONDS = 11
const REFRESH_WAIT_MS = 1_600

async function sessionAfterRun(cacheWarming: 'idle' | 'streaming') {
  const created = await createOpenWagglePiSession({
    appSettings: { codemodeEnabled: true, cacheWarming },
    extensionFactories: [alwaysWarm],
    promptCacheSeconds: PROMPT_CACHE_SECONDS,
    models: [
      {
        id: 'cached-model',
        contextWindow: 100_000,
        maxTokens: 10_000,
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      },
    ],
  })
  // The Run's answer, then one reply for each cache refresh.
  created.faux.setResponses([
    fauxAssistantMessage('Done.'),
    fauxAssistantMessage('.'),
    fauxAssistantMessage('.'),
  ])
  await created.session.prompt('Explain this repository in detail.')
  return created
}

function warmUsageEntries(session: AgentSession) {
  return session.sessionManager
    .getEntries()
    .flatMap((entry) => (entry.type === 'usage' && entry.kind === 'cache_warm' ? [entry] : []))
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function manualClock() {
  let now = 0
  const ticks = new Set<() => void>()
  return {
    now: () => now,
    every: (_ms: number, tick: () => void) => {
      ticks.add(tick)
      return () => {
        ticks.delete(tick)
      }
    },
    advance(ms: number) {
      now += ms
      for (const tick of [...ticks]) tick()
    },
  }
}

describe('keeping a prompt cache warm between Runs', () => {
  it('keeps refreshing the cache after the Run ends and records what each refresh cost', async () => {
    const { session } = await sessionAfterRun('idle')
    const warming = createIdleCacheWarming()

    await expect(warming.settle('session-a', session, { aborted: false })).resolves.toBe('warming')
    await wait(REFRESH_WAIT_MS)

    const [refresh] = warmUsageEntries(session)
    expect(refresh).toMatchObject({ provider: 'test-provider', model: 'cached-model' })
    expect(warming.borrow('session-a')).toBe(session)
    await warming.releaseAll()
  })

  it('ends the warming session before the next Run opens the Session, so they never both write', async () => {
    const { session } = await sessionAfterRun('idle')
    const warming = createIdleCacheWarming()
    await warming.settle('session-a', session, { aborted: false })

    await warming.release('session-a')
    const entriesWhenReleased = session.sessionManager.getEntries().length
    await wait(REFRESH_WAIT_MS)

    expect(session.sessionManager.getEntries()).toHaveLength(entriesWhenReleased)
    expect(warming.borrow('session-a')).toBeUndefined()
  })

  it('ends the Run session at once while warming only runs during work', async () => {
    const { session } = await sessionAfterRun('streaming')
    const warming = createIdleCacheWarming()

    await expect(warming.settle('session-a', session, { aborted: false })).resolves.toBe('disposed')
    await wait(REFRESH_WAIT_MS)

    expect(warmUsageEntries(session)).toEqual([])
    expect(warming.borrow('session-a')).toBeUndefined()
  })

  it('does not warm after a cancelled Run', async () => {
    const { session } = await sessionAfterRun('idle')
    const warming = createIdleCacheWarming()

    await expect(warming.settle('session-a', session, { aborted: true })).resolves.toBe('disposed')
    expect(warming.borrow('session-a')).toBeUndefined()
  })

  it('ends warming once Pi stops, or when the idle limit passes', async () => {
    const clock = manualClock()
    const stopped = await sessionAfterRun('idle')
    const lingering = await sessionAfterRun('idle')
    const warming = createIdleCacheWarming({ clock, maxIdleMs: 60_000, pollMs: 1_000 })
    await warming.settle('stopped', stopped.session, { aborted: false })
    await warming.settle('lingering', lingering.session, { aborted: false })

    stopped.session.setCacheWarmingMode('off')
    clock.advance(1_000)
    expect(warming.borrow('stopped')).toBeUndefined()
    expect(warming.borrow('lingering')).toBe(lingering.session)

    clock.advance(60_000)
    expect(warming.borrow('lingering')).toBeUndefined()
  })

  it('warms only the most recently settled Sessions', async () => {
    const warming = createIdleCacheWarming({ maxSessions: 1 })
    const first = await sessionAfterRun('idle')
    const second = await sessionAfterRun('idle')
    await warming.settle('first', first.session, { aborted: false })
    await warming.settle('second', second.session, { aborted: false })

    expect(warming.borrow('first')).toBeUndefined()
    expect(warming.borrow('second')).toBe(second.session)
    await warming.releaseAll()
    expect(warming.borrow('second')).toBeUndefined()
  })

  it("reads the Session's usage, refreshes included, from its warming session", async () => {
    const { session } = await sessionAfterRun('idle')
    const sessionId = SessionId('warming-session')
    await idleCacheWarming.settle(sessionId, session, { aborted: false })
    await wait(REFRESH_WAIT_MS)

    const usage = await getPiContextUsage({
      session: fromPartial<SessionDetail>({ id: sessionId, projectPath: '/unused' }),
      model: SupportedModelId('test-provider/cached-model'),
    })
    await idleCacheWarming.release(sessionId)

    const tokens = (usage: {
      input: number
      output: number
      cacheRead: number
      cacheWrite: number
    }) => usage.input + usage.output + usage.cacheRead + usage.cacheWrite
    const warmTokens = warmUsageEntries(session).reduce(
      (total, entry) => total + tokens(entry.usage),
      0,
    )
    const answerTokens = session.sessionManager
      .getEntries()
      .flatMap((entry) =>
        entry.type === 'message' && entry.message.role === 'assistant' ? [entry.message] : [],
      )
      .reduce((total, message) => total + tokens(message.usage), 0)
    expect(warmTokens).toBeGreaterThan(0)
    expect(usage?.session?.tokens).toBe(answerTokens + warmTokens)
  })
})
