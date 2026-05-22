import type { AgentSession } from '@mariozechner/pi-coding-agent'
import { logger } from './constants'

const POST_RUN_SETTLE_POLL_MS = 25
const POST_RUN_SETTLE_QUIET_MS = 150
const POST_RUN_SETTLE_MAX_MS = 15_000
const POST_RUN_IDLE_WAIT_SETTLED = 'settled'
const POST_RUN_IDLE_WAIT_TIMED_OUT = 'timed-out'

type PostRunIdleWaitResult = typeof POST_RUN_IDLE_WAIT_SETTLED | typeof POST_RUN_IDLE_WAIT_TIMED_OUT

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

function hasQueuedMessages(session: AgentSession) {
  return session.agent.hasQueuedMessages()
}

function getPostRunSettleRemainingMs(startedAt: number) {
  return Math.max(0, POST_RUN_SETTLE_MAX_MS - (Date.now() - startedAt))
}

async function waitForIdleWithin(
  session: AgentSession,
  timeoutMs: number,
): Promise<PostRunIdleWaitResult> {
  if (timeoutMs <= 0) {
    return POST_RUN_IDLE_WAIT_TIMED_OUT
  }

  const idleSettled = session.agent
    .waitForIdle()
    .then((): PostRunIdleWaitResult => POST_RUN_IDLE_WAIT_SETTLED)
  const idleTimedOut = wait(timeoutMs).then(
    (): PostRunIdleWaitResult => POST_RUN_IDLE_WAIT_TIMED_OUT,
  )
  return Promise.race([idleSettled, idleTimedOut])
}

async function waitForNextSettlementPoll(startedAt: number) {
  const remainingMs = getPostRunSettleRemainingMs(startedAt)
  if (remainingMs <= 0) {
    return false
  }

  await wait(Math.min(POST_RUN_SETTLE_POLL_MS, remainingMs))
  return true
}

function digestMessage(value: unknown) {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function buildSessionPostRunFingerprint(session: AgentSession) {
  const messages = session.agent.state.messages
  const lastMessage = messages.at(-1)
  return [
    messages.length,
    digestMessage(lastMessage),
    session.isCompacting ? 'compacting' : 'idle',
    session.isStreaming ? 'streaming' : 'ready',
    hasQueuedMessages(session) ? 'queued' : 'drained',
  ].join('|')
}

export async function waitForPostRunSettlement(session: AgentSession) {
  const startedAt = Date.now()
  let lastChangedAt = startedAt
  let lastFingerprint = buildSessionPostRunFingerprint(session)

  while (getPostRunSettleRemainingMs(startedAt) > 0) {
    const idleWaitResult = await waitForIdleWithin(session, getPostRunSettleRemainingMs(startedAt))
    if (idleWaitResult === POST_RUN_IDLE_WAIT_TIMED_OUT) {
      break
    }

    const fingerprint = buildSessionPostRunFingerprint(session)
    const hasPendingWork = session.isCompacting || session.isStreaming || hasQueuedMessages(session)
    const changed = fingerprint !== lastFingerprint

    if (changed || hasPendingWork) {
      lastFingerprint = fingerprint
      lastChangedAt = Date.now()
      await waitForNextSettlementPoll(startedAt)
      continue
    }

    if (Date.now() - lastChangedAt >= POST_RUN_SETTLE_QUIET_MS) {
      return
    }

    await waitForNextSettlementPoll(startedAt)
  }

  logger.warn('Timed out waiting for Pi post-run settlement before snapshot capture', {
    maxWaitMs: POST_RUN_SETTLE_MAX_MS,
    isCompacting: session.isCompacting,
    isStreaming: session.isStreaming,
    queuedMessages: hasQueuedMessages(session),
  })
}
