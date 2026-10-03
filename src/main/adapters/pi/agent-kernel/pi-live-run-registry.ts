import { createHash } from 'node:crypto'
import type { AgentSession } from '@earendil-works/pi-coding-agent'
import type {
  AgentSteerDeliveryReceipt,
  HydratedAttachment,
  InlineVisualizationContext,
} from '@shared/types/agent'
import type { SteeringDelivery } from '../../../domain/session-control/undelivered-steering'
import type { AgentSteeringResult } from '../../../ports/agent-steering-service'
import type { PiModel } from '../pi-provider-catalog'
import { stripAtomicVisualizationContext } from '../pi-runtime-input'
import { createPiRunControl } from './pi-run-control'
import {
  canAcceptReturnableSteer,
  createDeliveryTracker,
  type DeliveryTracker,
  deliveryCandidate,
  retainUndeliveredSteers,
  type SteerLedgerEntry,
  settleSteer,
} from './pi-steer-delivery-ledger'

interface PiLiveRun {
  readonly runId: string
  readonly session: AgentSession
  readonly model: PiModel
  readonly signal?: AbortSignal
  readonly routeThroughInputHook?: boolean
}

export interface PiLiveRunSteeringInput {
  readonly runId: string
  readonly text: string
  readonly attachments: readonly HydratedAttachment[]
  readonly visualizationContext?: InlineVisualizationContext
  readonly requireDurableDelivery?: boolean
  readonly delivery?: SteeringDelivery
}

interface RegisteredPiLiveRun {
  readonly run: PiLiveRun
  readonly controller: AbortController
  readonly control: ReturnType<typeof createPiRunControl>
  readonly inFlightUserTexts: ReadonlyMap<string, number>
  readonly inFlightMessages: ReadonlyMap<object, string>
  readonly pendingDeliveries: Set<DeliveryTracker>
  readonly deliveryListeners: Set<() => void>
  readonly stopObservingMessages?: () => void
  readonly steerLedger: SteerLedgerEntry[]
  steerTail: Promise<void>
}

const liveRuns = new Map<string, RegisteredPiLiveRun>()

function userContentText(
  content: string | readonly { readonly type: string; readonly text?: string }[],
) {
  return stripAtomicVisualizationContext(
    typeof content === 'string'
      ? content
      : (content.find((part) => part.type === 'text')?.text ?? ''),
  )
}

function observeInFlightUserMessages(session: AgentSession) {
  const inFlightUserTexts = new Map<string, number>()
  const inFlightMessages = new Map<object, string>()
  const pendingDeliveries = new Set<DeliveryTracker>()
  const deliveryListeners = new Set<() => void>()
  const stopObservingMessages = session.subscribe?.((event) => {
    if (
      (event.type !== 'message_start' && event.type !== 'message_end') ||
      event.message.role !== 'user'
    ) {
      return
    }
    if (event.type === 'message_start') {
      const text = userContentText(event.message.content)
      inFlightMessages.set(event.message, text)
      inFlightUserTexts.set(text, (inFlightUserTexts.get(text) ?? 0) + 1)
      for (const tracker of pendingDeliveries) {
        tracker.candidates.push({ message: event.message, originalText: text })
      }
      return
    }
    // Pi extensions can mutate the same message object before message_end. Match the
    // original start text, not the possibly transformed text emitted at the end.
    const text = inFlightMessages.get(event.message)
    // Pi emits message_end to subscribers before appending the SessionManager entry. Keep
    // the in-flight count through that append, then remove it in the next microtask.
    queueMicrotask(() => {
      if (text !== undefined) {
        inFlightMessages.delete(event.message)
        const count = inFlightUserTexts.get(text) ?? 0
        if (count <= 1) inFlightUserTexts.delete(text)
        else inFlightUserTexts.set(text, count - 1)
      }
      for (const listener of deliveryListeners) listener()
    })
  })
  return {
    inFlightUserTexts,
    inFlightMessages,
    pendingDeliveries,
    deliveryListeners,
    stopObservingMessages,
  }
}

export function registerPiLiveRun(run: PiLiveRun) {
  if (liveRuns.has(run.runId)) throw new Error(`Pi Run is already live: ${run.runId}`)
  const controller = new AbortController()
  const signal = run.signal ? AbortSignal.any([run.signal, controller.signal]) : controller.signal
  const observation = observeInFlightUserMessages(run.session)
  const registered: RegisteredPiLiveRun = {
    run,
    controller,
    control: createPiRunControl(run.session, signal, {
      routeThroughInputHook: run.routeThroughInputHook === true,
    }),
    ...observation,
    steerLedger: [],
    steerTail: Promise.resolve(),
  }
  liveRuns.set(run.runId, registered)
  return () => {
    const live = liveRuns.get(run.runId) === registered
    if (live) liveRuns.delete(run.runId)
    controller.abort()
    observation.stopObservingMessages?.()
    if (live) retainUndeliveredSteers(run.runId, registered.steerLedger)
  }
}

function awaitDurableSteerDelivery(input: {
  readonly liveRun: RegisteredPiLiveRun
  readonly runId: string
  readonly durableText: string
  readonly tracker: DeliveryTracker
}): Promise<boolean> {
  return new Promise((resolve, reject) => {
    let finished = false
    const finish = (delivered: boolean) => {
      if (finished) return
      finished = true
      input.liveRun.pendingDeliveries.delete(input.tracker)
      input.liveRun.deliveryListeners.delete(check)
      input.liveRun.controller.signal.removeEventListener('abort', check)
      resolve(delivered)
    }
    const check = () => {
      if (finished) return
      try {
        const target = deliveryCandidate(input.tracker, input.durableText)
        const delivered =
          target !== undefined &&
          input.liveRun.run.session.sessionManager
            .getEntries()
            .slice(input.tracker.entriesBefore)
            .some((entry) => entry.type === 'message' && entry.message === target.message)
        if (delivered) {
          finish(true)
          return
        }
        if (
          input.liveRun.controller.signal.aborted ||
          liveRuns.get(input.runId) !== input.liveRun
        ) {
          // Pi started incorporating the message before the Run ended. Returning the Follow-up
          // would deliver it twice, so the promotion counts even though no entry was persisted.
          finish(target !== undefined)
          return
        }
      } catch (error) {
        finished = true
        input.liveRun.pendingDeliveries.delete(input.tracker)
        input.liveRun.deliveryListeners.delete(check)
        input.liveRun.controller.signal.removeEventListener('abort', check)
        reject(error)
      }
    }
    input.liveRun.deliveryListeners.add(check)
    input.liveRun.controller.signal.addEventListener('abort', check, { once: true })
    check()
  })
}

/**
 * Start tracking a steer as it enters Pi run control. The snapshot is taken here, after every
 * earlier steer reached Pi, so an identical earlier steer is counted before this one.
 */
function beginSteerHandoff(
  liveRun: RegisteredPiLiveRun,
  input: PiLiveRunSteeringInput,
  ledgerEntry: SteerLedgerEntry | undefined,
): DeliveryTracker | undefined {
  if (!input.requireDurableDelivery && !ledgerEntry) return undefined
  const tracker = createDeliveryTracker({
    session: liveRun.run.session,
    inFlightUserTexts: liveRun.inFlightUserTexts,
    inFlightMessages: liveRun.inFlightMessages,
  })
  liveRun.pendingDeliveries.add(tracker)
  if (ledgerEntry) ledgerEntry.state = { stage: 'handing-off', tracker }
  return tracker
}

/** Record where a steer went once Pi run control returned it. */
function recordSteerHandoff(handoff: {
  readonly liveRun: RegisteredPiLiveRun
  readonly input: PiLiveRunSteeringInput
  readonly delivery: Awaited<ReturnType<RegisteredPiLiveRun['control']['steer']>>
  readonly tracker?: DeliveryTracker
  readonly ledgerEntry?: SteerLedgerEntry
}): 'accepted' | 'refused' {
  const { liveRun, input, delivery, tracker, ledgerEntry } = handoff
  const stopTracking = () => {
    if (tracker) liveRun.pendingDeliveries.delete(tracker)
    settleSteer(ledgerEntry)
  }
  if (delivery.delivery === 'handled') {
    stopTracking()
    return 'accepted'
  }
  if (!input.requireDurableDelivery && liveRuns.get(input.runId) !== liveRun) {
    // The Run ended while Pi queued this steer, after its Undelivered steering messages were
    // collected. If Pi already started it, it reached the Run. Otherwise refuse it so the caller
    // keeps the message instead of a disposed Pi queue.
    const started = tracker !== undefined && deliveryCandidate(tracker, delivery.durableText)
    stopTracking()
    return started ? 'accepted' : 'refused'
  }
  if (ledgerEntry && tracker) {
    ledgerEntry.state = { stage: 'queued', tracker, durableText: delivery.durableText }
  }
  return 'accepted'
}

export async function steerPiLiveRun(input: PiLiveRunSteeringInput): Promise<AgentSteeringResult> {
  const liveRun = liveRuns.get(input.runId)
  if (!liveRun) return { accepted: false, code: 'run_not_live' }
  if (input.delivery?.kind === 'steer' && !canAcceptReturnableSteer(liveRun.steerLedger)) {
    return { accepted: false, code: 'steering_capacity_reached' }
  }
  // Recorded on arrival, so a Run that ends hands its steers back in the order they were sent.
  const ledgerEntry: SteerLedgerEntry | undefined = input.delivery
    ? { delivery: input.delivery, state: { stage: 'awaiting-handoff' } }
    : undefined
  if (ledgerEntry) liveRun.steerLedger.push(ledgerEntry)
  const settleLedgerEntry = () => settleSteer(ledgerEntry)
  const steering = liveRun.steerTail.then(async () => {
    if (liveRuns.get(input.runId) !== liveRun) {
      settleLedgerEntry()
      return { result: { accepted: false, code: 'run_not_live' } as const }
    }
    if (!liveRun.run.session.isStreaming && !liveRun.run.session.isCompacting) {
      settleLedgerEntry()
      return { result: { accepted: false, code: 'run_not_streaming' } as const }
    }
    const tracker = beginSteerHandoff(liveRun, input, ledgerEntry)
    let delivery: Awaited<ReturnType<typeof liveRun.control.steer>>
    try {
      delivery = await liveRun.control.steer({
        text: input.text,
        attachments: input.attachments,
        ...(input.visualizationContext ? { visualizationContext: input.visualizationContext } : {}),
      })
    } catch (error) {
      if (tracker) liveRun.pendingDeliveries.delete(tracker)
      settleLedgerEntry()
      throw error
    }
    const tracking = { ...(tracker ? { tracker } : {}), ...(ledgerEntry ? { ledgerEntry } : {}) }
    if (recordSteerHandoff({ liveRun, input, delivery, ...tracking }) === 'refused') {
      return { result: { accepted: false, code: 'run_not_live' } as const }
    }
    const receipt: AgentSteerDeliveryReceipt =
      delivery.delivery === 'handled'
        ? { delivery: 'handled' }
        : {
            delivery: 'queued',
            minimumCreatedOrder: delivery.minimumCreatedOrder,
            durableTextSha256: createHash('sha256')
              .update(delivery.durableText, 'utf8')
              .digest('hex'),
          }
    return { result: { accepted: true, receipt } as const, delivery, tracker }
  })
  const ignore = () => undefined
  liveRun.steerTail = steering.then(ignore, ignore)
  const outcome = await steering
  if (!outcome.result.accepted || !input.requireDurableDelivery || !outcome.delivery) {
    return outcome.result
  }
  if (outcome.delivery.delivery === 'handled') return outcome.result
  if (!outcome.tracker) return outcome.result
  const durableText = outcome.delivery.durableText
  const delivered = await awaitDurableSteerDelivery({
    liveRun,
    runId: input.runId,
    durableText,
    tracker: outcome.tracker,
  })
  return delivered ? outcome.result : { accepted: false, code: 'run_not_live' }
}
