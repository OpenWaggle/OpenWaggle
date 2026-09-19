import { createHash } from 'node:crypto'
import type { AgentSession } from '@earendil-works/pi-coding-agent'
import type {
  AgentSteerDeliveryReceipt,
  HydratedAttachment,
  InlineVisualizationContext,
} from '@shared/types/agent'
import type { AgentSteeringResult } from '../../../ports/agent-steering-service'
import type { PiModel } from '../pi-provider-catalog'
import { stripAtomicVisualizationContext } from '../pi-runtime-input'
import { createPiRunControl } from './pi-run-control'

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
  steerTail: Promise<void>
}

interface DeliveryTracker {
  readonly entriesBefore: number
  readonly steerTextsBefore: readonly string[]
  readonly inFlightUserTextsBefore: ReadonlyMap<string, number>
  readonly candidates: Array<{ readonly message: object; readonly originalText: string }>
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
    steerTail: Promise.resolve(),
  }
  liveRuns.set(run.runId, registered)
  return () => {
    controller.abort()
    observation.stopObservingMessages?.()
    if (liveRuns.get(run.runId) === registered) liveRuns.delete(run.runId)
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
        const matchingSteersBefore = input.tracker.steerTextsBefore.filter(
          (text) => stripAtomicVisualizationContext(text) === input.durableText,
        ).length
        const matchingInFlightBefore =
          input.tracker.inFlightUserTextsBefore.get(input.durableText) ?? 0
        const target = input.tracker.candidates.filter(
          (candidate) => candidate.originalText === input.durableText,
        )[matchingSteersBefore + matchingInFlightBefore]
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
          finish(false)
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

export async function steerPiLiveRun(input: PiLiveRunSteeringInput): Promise<AgentSteeringResult> {
  const liveRun = liveRuns.get(input.runId)
  if (!liveRun) return { accepted: false, code: 'run_not_live' }
  const steering = liveRun.steerTail.then(async () => {
    if (liveRuns.get(input.runId) !== liveRun) {
      return { result: { accepted: false, code: 'run_not_live' } as const }
    }
    if (!liveRun.run.session.isStreaming && !liveRun.run.session.isCompacting) {
      return { result: { accepted: false, code: 'run_not_streaming' } as const }
    }
    const tracker: DeliveryTracker | undefined = input.requireDurableDelivery
      ? {
          entriesBefore: liveRun.run.session.sessionManager.getEntries().length,
          steerTextsBefore: [...(liveRun.run.session.getSteeringMessages?.() ?? [])],
          inFlightUserTextsBefore: new Map(liveRun.inFlightUserTexts),
          candidates: [...liveRun.inFlightMessages].map(([message, originalText]) => ({
            message,
            originalText,
          })),
        }
      : undefined
    if (tracker) liveRun.pendingDeliveries.add(tracker)
    let delivery: Awaited<ReturnType<typeof liveRun.control.steer>>
    try {
      delivery = await liveRun.control.steer({
        text: input.text,
        thinkingLevel: 'off',
        attachments: input.attachments,
        ...(input.visualizationContext ? { visualizationContext: input.visualizationContext } : {}),
      })
    } catch (error) {
      if (tracker) liveRun.pendingDeliveries.delete(tracker)
      throw error
    }
    if (delivery.delivery === 'handled' && tracker) liveRun.pendingDeliveries.delete(tracker)
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
    return {
      result: { accepted: true, receipt } as const,
      delivery,
      tracker,
    }
  })
  liveRun.steerTail = steering.then(
    () => undefined,
    () => undefined,
  )
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
