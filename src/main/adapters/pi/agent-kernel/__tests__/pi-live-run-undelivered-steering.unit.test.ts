import type { AgentSession, SessionEntry } from '@earendil-works/pi-coding-agent'
import { FollowUpId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionControlFollowUp } from '../../../../domain/session-control/message-aggregate'
import type { PiModel } from '../../pi-provider-catalog'
import { registerPiLiveRun, steerPiLiveRun } from '../pi-live-run-registry'
import { takeUndeliveredPiSteers } from '../pi-steer-delivery-ledger'

type SessionEvent = Parameters<Parameters<AgentSession['subscribe']>[0]>[0]
type UserMessage = Extract<SessionEvent, { type: 'message_start' }>['message']

function userMessage(text: string) {
  return fromPartial<UserMessage>({ role: 'user', content: [{ type: 'text', text }] })
}

function followUp(id: string, text: string): SessionControlFollowUp {
  return {
    id: FollowUpId(id),
    deliveryState: 'pending',
    intent: {
      text,
      attachmentIds: [],
      callerId: 'session-agent:parent',
      acceptedAt: 1000,
      idempotencyKey: `key-${id}`,
    },
  }
}

function liveSession(options: { readonly compacting?: boolean } = {}) {
  const listeners = new Set<Parameters<AgentSession['subscribe']>[0]>()
  const entries: SessionEntry[] = []
  const state = { compacting: options.compacting === true }
  const steer = vi.fn(async (text: string) => text)
  const session = fromPartial<AgentSession>({
    isStreaming: true,
    get isCompacting() {
      return state.compacting
    },
    steer,
    getSteeringMessages: () => [],
    subscribe: (listener: Parameters<AgentSession['subscribe']>[0]) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    sessionManager: { getEntries: () => entries, appendCustomEntry: vi.fn() },
  })
  const emit = (type: 'message_start' | 'message_end', message: UserMessage) => {
    for (const listener of listeners) listener(fromPartial<SessionEvent>({ type, message }))
  }
  return {
    session,
    steer,
    state,
    start: (text: string) => {
      const message = userMessage(text)
      emit('message_start', message)
      return message
    },
    persist: (message: UserMessage) => {
      emit('message_end', message)
      entries.push(fromPartial<SessionEntry>({ type: 'message', message }))
    },
  }
}

const model = fromPartial<PiModel>({ input: ['text'] })

describe('Pi Undelivered steering messages', () => {
  let unregister: (() => void) | undefined

  afterEach(() => {
    unregister?.()
    unregister = undefined
  })

  it('hands back a queued steer, once, when the Run ends without incorporating it', async () => {
    const live = liveSession()
    unregister = registerPiLiveRun({ runId: 'run-stopped', session: live.session, model })
    const delivery = { kind: 'steer', followUp: followUp('direct', 'Check the logs.') } as const

    await expect(
      steerPiLiveRun({ runId: 'run-stopped', text: 'Check the logs.', attachments: [], delivery }),
    ).resolves.toMatchObject({ accepted: true, receipt: { delivery: 'queued' } })
    unregister()
    unregister = undefined

    expect(takeUndeliveredPiSteers('run-stopped')).toEqual([{ delivery, handedOff: true }])
    expect(takeUndeliveredPiSteers('run-stopped')).toEqual([])
  })

  it('hands back nothing after Pi incorporated the steer before the Run completed', async () => {
    const live = liveSession()
    unregister = registerPiLiveRun({ runId: 'run-completed', session: live.session, model })

    await steerPiLiveRun({
      runId: 'run-completed',
      text: 'Also update the docs.',
      attachments: [],
      delivery: { kind: 'steer', followUp: followUp('direct', 'Also update the docs.') },
    })
    live.persist(live.start('Also update the docs.'))
    unregister()
    unregister = undefined

    expect(takeUndeliveredPiSteers('run-completed')).toEqual([])
  })

  it('never hands back a steer Pi started incorporating before the abort', async () => {
    const live = liveSession()
    unregister = registerPiLiveRun({
      runId: 'run-aborted-mid-message',
      session: live.session,
      model,
    })

    await steerPiLiveRun({
      runId: 'run-aborted-mid-message',
      text: 'Stop after this file.',
      attachments: [],
      delivery: { kind: 'steer', followUp: followUp('direct', 'Stop after this file.') },
    })
    live.start('Stop after this file.')
    unregister()
    unregister = undefined

    expect(takeUndeliveredPiSteers('run-aborted-mid-message')).toEqual([])
  })

  it('does not mistake an earlier identical message for the steer', async () => {
    const live = liveSession()
    unregister = registerPiLiveRun({ runId: 'run-identical', session: live.session, model })
    const earlier = live.start('Same words.')
    const delivery = { kind: 'steer', followUp: followUp('direct', 'Same words.') } as const

    await steerPiLiveRun({ runId: 'run-identical', text: 'Same words.', attachments: [], delivery })
    live.persist(earlier)
    unregister()
    unregister = undefined

    expect(takeUndeliveredPiSteers('run-identical')).toEqual([{ delivery, handedOff: true }])
  })

  it('reports steers in the order they were sent, including one still waiting for compaction', async () => {
    const live = liveSession()
    unregister = registerPiLiveRun({ runId: 'run-ordered', session: live.session, model })
    const first = { kind: 'steer', followUp: followUp('first', 'First.') } as const
    const promoted = { kind: 'promoted-follow-up', followUpId: FollowUpId('promoted') } as const
    const waiting = { kind: 'steer', followUp: followUp('waiting', 'Waiting.') } as const

    await steerPiLiveRun({ runId: 'run-ordered', text: 'First.', attachments: [], delivery: first })
    const promotion = steerPiLiveRun({
      runId: 'run-ordered',
      text: 'Promoted.',
      attachments: [],
      requireDurableDelivery: true,
      delivery: promoted,
    })
    await vi.waitFor(() => expect(live.steer).toHaveBeenCalledTimes(2))
    live.state.compacting = true
    const compactionBlocked = steerPiLiveRun({
      runId: 'run-ordered',
      text: 'Waiting.',
      attachments: [],
      delivery: waiting,
    })
    // Let the third steer reach Pi run control, where it waits for compaction to finish.
    await new Promise((resolve) => setTimeout(resolve, 30))
    unregister()
    unregister = undefined

    await expect(promotion).resolves.toEqual({ accepted: false, code: 'run_not_live' })
    await expect(compactionBlocked).rejects.toThrow()
    expect(live.steer).toHaveBeenCalledTimes(2)
    expect(takeUndeliveredPiSteers('run-ordered')).toEqual([
      { delivery: first, handedOff: true },
      { delivery: promoted, handedOff: true },
      { delivery: waiting, handedOff: false },
    ])
  })

  it('counts a promotion Pi started incorporating when the Run ended before persisting it', async () => {
    const live = liveSession()
    unregister = registerPiLiveRun({ runId: 'run-started-promotion', session: live.session, model })

    const promotion = steerPiLiveRun({
      runId: 'run-started-promotion',
      text: 'Promote me.',
      attachments: [],
      requireDurableDelivery: true,
      delivery: { kind: 'promoted-follow-up', followUpId: FollowUpId('promoted') },
    })
    await vi.waitFor(() => expect(live.steer).toHaveBeenCalledOnce())
    live.start('Promote me.')
    unregister()
    unregister = undefined

    await expect(promotion).resolves.toMatchObject({ accepted: true })
    expect(takeUndeliveredPiSteers('run-started-promotion')).toEqual([])
  })

  it('refuses a steer Pi queued only after the Run ended', async () => {
    const live = liveSession()
    let releaseSteer: () => void = () => undefined
    live.steer.mockImplementationOnce(
      (text: string) =>
        new Promise<string>((resolve) => {
          releaseSteer = () => resolve(text)
        }),
    )
    unregister = registerPiLiveRun({ runId: 'run-late-handoff', session: live.session, model })

    const steering = steerPiLiveRun({
      runId: 'run-late-handoff',
      text: 'Late.',
      attachments: [],
      delivery: { kind: 'steer', followUp: followUp('late', 'Late.') },
    })
    await vi.waitFor(() => expect(live.steer).toHaveBeenCalledOnce())
    unregister()
    unregister = undefined
    releaseSteer()

    await expect(steering).resolves.toEqual({ accepted: false, code: 'run_not_live' })
    expect(takeUndeliveredPiSteers('run-late-handoff')).toEqual([
      {
        delivery: { kind: 'steer', followUp: followUp('late', 'Late.') },
        handedOff: false,
      },
    ])
  })
})
