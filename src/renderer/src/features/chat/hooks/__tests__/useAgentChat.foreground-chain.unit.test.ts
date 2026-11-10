import { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import { describe, expect, it } from 'vitest'
import { SendFailedOutOfView } from '../../lib/message-delivery'
import { beginForegroundRun } from '../useAgentChat.foreground-run'
import { createPendingRunWaiter } from '../useAgentChat.message-cache'
import {
  forgetIfFailedOutOfView,
  forgetIfRefusedForPiSessionFile,
} from '../useAgentChat.send-without-run'
import type { AgentChatStatus, MutableValueRef, PendingRunWaiter } from '../useAgentChat.types'

const SESSION = SessionId('session-chain')

/** The refs and setters `beginForegroundRun` drives, for a Session on screen and ready. */
function foreground() {
  const currentSessionIdRef: MutableValueRef<SessionId | null> = { current: SESSION }
  const statusRef: MutableValueRef<AgentChatStatus> = { current: 'ready' }
  const foregroundSessionIdRef: MutableValueRef<SessionId | null> = { current: null }
  const terminalRunErrorRef: MutableValueRef<Error | undefined> = { current: undefined }
  const pendingRunWaiterRef: MutableValueRef<PendingRunWaiter | null> = { current: null }
  const messagesBySessionIdRef: MutableValueRef<Map<SessionId, UIMessage[]>> = {
    current: new Map(),
  }
  const refs = {
    currentSessionIdRef,
    statusRef,
    foregroundStreamActiveRef: { current: false },
    foregroundSessionIdRef,
    terminalRunErrorRef,
    pendingRunWaiterRef,
    messagesBySessionIdRef,
  }
  const setters = {
    error: undefined,
    setError: () => {},
    setStatus: (status: AgentChatStatus) => {
      refs.statusRef.current = status
    },
    setBackgroundStreaming: () => {},
    setMessagesBySessionId: () => {},
    setRunRenderMessages: () => {},
    removeOptimisticUserMessage: () => {},
  }
  return { refs, setters }
}

/** Every order of `0..count-1`. */
function orders(count: number): number[][] {
  if (count === 1) return [[0]]
  return orders(count - 1).flatMap((order) =>
    Array.from({ length: order.length + 1 }, (_, at) => [
      ...order.slice(0, at),
      count - 1,
      ...order.slice(at),
    ]),
  )
}

/*
 * Sends that each end without a Run (refused or queued) hand the foreground back in any order.
 * Once all have, nothing is followed and the Session is ready again: left on a spent waiter, it
 * showed "Thinking" and Stop over nothing.
 */
describe('a chain of sends that end without a Run', () => {
  const cases = [3, 4].flatMap((count) => orders(count).map((order) => [order.join(' ')] as const))

  it.each(cases)('ends ready whatever the order they end in: %s', (label) => {
    const order = label.split(' ').map(Number)
    const { refs, setters } = foreground()
    const runs = order.map(() => beginForegroundRun(refs, setters, SESSION))
    for (const index of order) runs[index]?.handBack(refs, SESSION, setters)

    expect(refs.statusRef.current).toBe('ready')
    expect(refs.pendingRunWaiterRef.current).toBeNull()
    expect(refs.foregroundStreamActiveRef.current).toBe(false)
  })
})

const PI_FILE_REFUSAL =
  "This Session's Pi session file was deleted outside OpenWaggle (/p/s.jsonl), so its history is gone and it cannot be continued. Restore the file to continue it."

// The Host refuses a Run whose Pi file is gone when it starts, after a later send may have begun.
describe('a send refused for its Pi session file while a later send runs', () => {
  it('leaves the later send its Thinking, and hands back to ready when it ends', () => {
    const { refs, setters } = foreground()
    const earlier = beginForegroundRun(refs, setters, SESSION)
    const later = beginForegroundRun(refs, setters, SESSION)
    refs.statusRef.current = 'submitted'

    const refusal = forgetIfRefusedForPiSessionFile(
      { refs, setters, targetSessionId: SESSION, run: earlier, optimisticMessageId: 'earlier' },
      new Error(PI_FILE_REFUSAL),
    )

    expect(refusal).toMatchObject({ outcome: 'refused' })
    expect(refs.statusRef.current).toBe('submitted')
    expect(refs.pendingRunWaiterRef.current).toBe(later.waiter)

    later.handBack(refs, SESSION, setters)
    expect(refs.statusRef.current).toBe('ready')
    expect(refs.pendingRunWaiterRef.current).toBeNull()
  })
})

/*
 * The earlier Run's completion lands on a send that then ends without a Run: it is passed on to
 * the earlier send's waiter, which it settles. Handed back, that spent waiter was followed again,
 * so the next Run this renderer did not send (a Resume, a Hive wake, a CLI message) was offered to
 * it, dropped, and left the Session on Stop after it ended.
 */
describe('a send that ends without a Run after the earlier Run completed', () => {
  it.each([
    ['named', { runId: 'run-1' }],
    ['unnamed', {}],
  ])('follows nothing once it hands back, with the completion %s', (_, completion) => {
    const { refs, setters } = foreground()
    const earlier = createPendingRunWaiter()
    let earlierSettled = false
    void earlier.promise.then(() => {
      earlierSettled = true
    })
    refs.pendingRunWaiterRef.current = earlier.waiter
    refs.foregroundStreamActiveRef.current = true
    refs.foregroundSessionIdRef.current = SESSION
    const send = beginForegroundRun(refs, setters, SESSION)

    send.waiter.complete?.(completion)
    send.handBack(refs, SESSION, setters)

    expect(refs.pendingRunWaiterRef.current).toBeNull()
    expect(refs.foregroundStreamActiveRef.current).toBe(false)
    expect(refs.foregroundSessionIdRef.current).toBeNull()
    return Promise.resolve().then(() => expect(earlierSettled).toBe(true))
  })

  it('hands a later send nothing to follow when it splices out', () => {
    const { refs, setters } = foreground()
    const earlier = createPendingRunWaiter()
    refs.pendingRunWaiterRef.current = earlier.waiter
    const send = beginForegroundRun(refs, setters, SESSION)
    send.waiter.complete?.({})
    const later = beginForegroundRun(refs, setters, SESSION)

    send.handBack(refs, SESSION, setters)
    later.handBack(refs, SESSION, setters)

    expect(refs.pendingRunWaiterRef.current).toBeNull()
    expect(refs.foregroundStreamActiveRef.current).toBe(false)
  })
})

/*
 * The newest send fails before any Run while an earlier send's Run still settles. Clearing the
 * foreground then dropped the earlier Run's completion: that send never settled, and the
 * Session's pickers stayed locked behind it. The failing send hands the earlier one back instead.
 */
describe('the newest send failing while an earlier Run still settles', () => {
  function earlierRunStreaming() {
    const { refs, setters } = foreground()
    const earlier = createPendingRunWaiter()
    let earlierSettled = false
    void earlier.promise.then(() => {
      earlierSettled = true
    })
    refs.pendingRunWaiterRef.current = earlier.waiter
    refs.foregroundStreamActiveRef.current = true
    refs.foregroundSessionIdRef.current = SESSION
    refs.statusRef.current = 'streaming'
    const send = beginForegroundRun(refs, setters, SESSION)
    const sent = { refs, setters, targetSessionId: SESSION, run: send, optimisticMessageId: 'x' }
    return { refs, earlier, sent, settled: () => earlierSettled }
  }

  it('hands back the earlier Run when its invoke fails', async () => {
    const { refs, earlier, sent, settled } = earlierRunStreaming()

    const failure = forgetIfFailedOutOfView(sent, new Error('handler died'))

    expect(failure).toBeInstanceOf(SendFailedOutOfView)
    expect(refs.pendingRunWaiterRef.current).toBe(earlier.waiter)
    expect(refs.statusRef.current).toBe('streaming')
    refs.pendingRunWaiterRef.current?.resolve()
    await Promise.resolve()
    expect(settled()).toBe(true)
  })

  it('hands back the earlier Run when the Host refuses it for its Pi file', async () => {
    const { refs, earlier, sent, settled } = earlierRunStreaming()

    const refusal = forgetIfRefusedForPiSessionFile(sent, new Error(PI_FILE_REFUSAL))

    expect(refusal).toMatchObject({ outcome: 'refused' })
    expect(refs.pendingRunWaiterRef.current).toBe(earlier.waiter)
    expect(refs.statusRef.current).toBe('streaming')
    refs.pendingRunWaiterRef.current?.resolve()
    await Promise.resolve()
    expect(settled()).toBe(true)
  })

  it('shows its own failure when it displaced no pending send', () => {
    const { refs, setters } = foreground()
    const send = beginForegroundRun(refs, setters, SESSION)
    const sent = { refs, setters, targetSessionId: SESSION, run: send, optimisticMessageId: 'x' }

    expect(forgetIfFailedOutOfView(sent, new Error('handler died'))).toBeUndefined()
    expect(refs.pendingRunWaiterRef.current).toBe(send.waiter)
  })
})
