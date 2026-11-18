import { createHash } from 'node:crypto'
import type { AgentSession, SessionEntry } from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PiModel } from '../../pi-provider-catalog'
import { registerPiLiveRun, steerPiLiveRun } from '../pi-live-run-registry'

type SessionEvent = Parameters<Parameters<AgentSession['subscribe']>[0]>[0]
type UserMessage = Extract<SessionEvent, { type: 'message_start' }>['message']

function userMessage(text: string) {
  return fromPartial<UserMessage>({
    role: 'user',
    content: [{ type: 'text', text }],
  })
}

function sessionEvents() {
  const listeners = new Set<Parameters<AgentSession['subscribe']>[0]>()
  return {
    subscribe: (next: Parameters<AgentSession['subscribe']>[0]) => {
      listeners.add(next)
      return () => {
        listeners.delete(next)
      }
    },
    emitMessage: (type: 'message_start' | 'message_end', message: UserMessage) => {
      for (const listener of listeners) listener(fromPartial<SessionEvent>({ type, message }))
    },
  }
}

function persistUserMessage(
  events: ReturnType<typeof sessionEvents>,
  entries: SessionEntry[],
  message: UserMessage,
) {
  events.emitMessage('message_end', message)
  entries.push(fromPartial<SessionEntry>({ type: 'message', message }))
}

describe('Pi durable steering delivery', () => {
  let unregister: (() => void) | undefined

  afterEach(() => unregister?.())

  it('does not accept a promoted steer that was queued but never persisted', async () => {
    const steer = vi.fn(async (text: string) => text)
    const session = fromPartial<AgentSession>({
      isStreaming: true,
      steer,
      subscribe: () => () => undefined,
      sessionManager: { getEntries: () => [], appendCustomEntry: vi.fn() },
    })
    const model = fromPartial<PiModel>({ input: ['text'] })
    unregister = registerPiLiveRun({ runId: 'run-undelivered-promotion', session, model })

    const promotion = steerPiLiveRun({
      runId: 'run-undelivered-promotion',
      text: 'Keep this durable Follow-up.',
      attachments: [],
      requireDurableDelivery: true,
    })
    await vi.waitFor(() => expect(steer).toHaveBeenCalledOnce())
    unregister()

    await expect(promotion).resolves.toEqual({ accepted: false, code: 'run_not_live' })
  })

  it('accepts a promoted steer only after its user entry is persisted', async () => {
    const text = 'Promote this exactly once.'
    const entries: SessionEntry[] = []
    const events = sessionEvents()
    const steer = vi.fn(async (value: string) => value)
    const session = fromPartial<AgentSession>({
      isStreaming: true,
      steer,
      subscribe: events.subscribe,
      sessionManager: { getEntries: () => entries, appendCustomEntry: vi.fn() },
    })
    const model = fromPartial<PiModel>({ input: ['text'] })
    unregister = registerPiLiveRun({ runId: 'run-delivered-promotion', session, model })

    const promotion = steerPiLiveRun({
      runId: 'run-delivered-promotion',
      text,
      attachments: [],
      requireDurableDelivery: true,
    })
    await vi.waitFor(() => expect(steer).toHaveBeenCalledOnce())
    const message = userMessage(text)
    events.emitMessage('message_start', message)
    persistUserMessage(events, entries, message)

    await expect(promotion).resolves.toEqual({
      accepted: true,
      receipt: {
        delivery: 'queued',
        durableTextSha256: createHash('sha256').update(text).digest('hex'),
        minimumCreatedOrder: 0,
      },
    })
    expect(steer).toHaveBeenCalledOnce()
  })

  it('accepts the same Pi message when an extension transforms its text before persistence', async () => {
    const originalText = 'Promote the original request.'
    const entries: SessionEntry[] = []
    const events = sessionEvents()
    const steer = vi.fn(async (value: string) => value)
    const session = fromPartial<AgentSession>({
      isStreaming: true,
      steer,
      subscribe: events.subscribe,
      sessionManager: { getEntries: () => entries, appendCustomEntry: vi.fn() },
    })
    const model = fromPartial<PiModel>({ input: ['text'] })
    unregister = registerPiLiveRun({ runId: 'run-transformed-promotion', session, model })

    const promotion = steerPiLiveRun({
      runId: 'run-transformed-promotion',
      text: originalText,
      attachments: [],
      requireDurableDelivery: true,
    })
    await vi.waitFor(() => expect(steer).toHaveBeenCalledOnce())
    const message = userMessage(originalText)
    events.emitMessage('message_start', message)
    const transformed = userMessage('Extension-transformed request.')
    Object.assign(message, transformed)
    persistUserMessage(events, entries, message)
    await expect(promotion).resolves.toMatchObject({ accepted: true })

    // The transformed end must also clear the original-text in-flight count.
    const nextPromotion = steerPiLiveRun({
      runId: 'run-transformed-promotion',
      text: originalText,
      attachments: [],
      requireDurableDelivery: true,
    })
    await vi.waitFor(() => expect(steer).toHaveBeenCalledTimes(2))
    const nextMessage = userMessage(originalText)
    events.emitMessage('message_start', nextMessage)
    persistUserMessage(events, entries, nextMessage)
    await expect(nextPromotion).resolves.toMatchObject({ accepted: true })
  })

  it('waits through Run abort for late Pi persistence before rejecting a promotion', async () => {
    const text = 'Persist during abort teardown.'
    const entries: SessionEntry[] = []
    const events = sessionEvents()
    const runController = new AbortController()
    const steer = vi.fn(async (value: string) => value)
    const session = fromPartial<AgentSession>({
      isStreaming: true,
      steer,
      subscribe: events.subscribe,
      sessionManager: { getEntries: () => entries, appendCustomEntry: vi.fn() },
    })
    const model = fromPartial<PiModel>({ input: ['text'] })
    unregister = registerPiLiveRun({
      runId: 'run-aborting-promotion',
      session,
      model,
      signal: runController.signal,
    })

    let completed = false
    const promotion = steerPiLiveRun({
      runId: 'run-aborting-promotion',
      text,
      attachments: [],
      requireDurableDelivery: true,
    }).then((result) => {
      completed = true
      return result
    })
    await vi.waitFor(() => expect(steer).toHaveBeenCalledOnce())
    runController.abort()
    await new Promise((resolve) => setTimeout(resolve, 35))
    expect(completed).toBe(false)
    const message = userMessage(text)
    events.emitMessage('message_start', message)
    persistUserMessage(events, entries, message)
    unregister()

    await expect(promotion).resolves.toMatchObject({ accepted: true })
  })

  it('does not mistake an older identical queued steer for the promoted delivery', async () => {
    const text = 'Same instruction.'
    const entries: SessionEntry[] = []
    const events = sessionEvents()
    const steer = vi.fn(async (value: string) => value)
    const session = fromPartial<AgentSession>({
      isStreaming: true,
      steer,
      subscribe: events.subscribe,
      getSteeringMessages: () => [text],
      sessionManager: { getEntries: () => entries, appendCustomEntry: vi.fn() },
    })
    const model = fromPartial<PiModel>({ input: ['text'] })
    unregister = registerPiLiveRun({ runId: 'run-identical-promotion', session, model })

    let completed = false
    const promotion = steerPiLiveRun({
      runId: 'run-identical-promotion',
      text,
      attachments: [],
      requireDurableDelivery: true,
    }).then((result) => {
      completed = true
      return result
    })
    await vi.waitFor(() => expect(steer).toHaveBeenCalledOnce())
    const olderMessage = userMessage(text)
    events.emitMessage('message_start', olderMessage)
    persistUserMessage(events, entries, olderMessage)
    await new Promise((resolve) => setTimeout(resolve, 35))
    expect(completed).toBe(false)
    const promotedMessage = userMessage(text)
    events.emitMessage('message_start', promotedMessage)
    persistUserMessage(events, entries, promotedMessage)

    await expect(promotion).resolves.toMatchObject({ accepted: true })
    expect(steer).toHaveBeenCalledOnce()
  })

  it('does not mistake an older identical in-flight steer for the promoted delivery', async () => {
    const text = 'Same instruction in flight.'
    const entries: SessionEntry[] = []
    const events = sessionEvents()
    const steer = vi.fn(async (value: string) => value)
    const session = fromPartial<AgentSession>({
      isStreaming: true,
      steer,
      getSteeringMessages: () => [],
      sessionManager: { getEntries: () => entries, appendCustomEntry: vi.fn() },
      subscribe: events.subscribe,
    })
    const model = fromPartial<PiModel>({ input: ['text'] })
    unregister = registerPiLiveRun({ runId: 'run-in-flight-identical-promotion', session, model })
    const olderMessage = userMessage(text)
    events.emitMessage('message_start', olderMessage)

    let completed = false
    const promotion = steerPiLiveRun({
      runId: 'run-in-flight-identical-promotion',
      text,
      attachments: [],
      requireDurableDelivery: true,
    }).then((result) => {
      completed = true
      return result
    })
    await vi.waitFor(() => expect(steer).toHaveBeenCalledOnce())
    persistUserMessage(events, entries, olderMessage)
    await new Promise((resolve) => setTimeout(resolve, 35))
    expect(completed).toBe(false)
    const promotedMessage = userMessage(text)
    events.emitMessage('message_start', promotedMessage)
    persistUserMessage(events, entries, promotedMessage)

    await expect(promotion).resolves.toMatchObject({ accepted: true })
  })

  it('does not block a later ordinary steer while promotion awaits persistence', async () => {
    const entries: SessionEntry[] = []
    const steer = vi.fn(async (text: string) => text)
    const session = fromPartial<AgentSession>({
      isStreaming: true,
      steer,
      subscribe: () => () => undefined,
      sessionManager: { getEntries: () => entries, appendCustomEntry: vi.fn() },
    })
    const model = fromPartial<PiModel>({ input: ['text'] })
    unregister = registerPiLiveRun({ runId: 'run-promotion-and-steer', session, model })

    const promotion = steerPiLiveRun({
      runId: 'run-promotion-and-steer',
      text: 'Promoted Follow-up.',
      attachments: [],
      requireDurableDelivery: true,
    })
    await vi.waitFor(() => expect(steer).toHaveBeenCalledOnce())

    await expect(
      steerPiLiveRun({
        runId: 'run-promotion-and-steer',
        text: 'Later ordinary steer.',
        attachments: [],
      }),
    ).resolves.toMatchObject({ accepted: true })
    expect(steer).toHaveBeenCalledTimes(2)

    unregister()
    await expect(promotion).resolves.toEqual({ accepted: false, code: 'run_not_live' })
  })
})
