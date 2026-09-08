import { createHash } from 'node:crypto'
import type { AgentSession } from '@earendil-works/pi-coding-agent'
import type {
  AgentSteerDeliveryReceipt,
  HydratedAttachment,
  InlineVisualizationContext,
} from '@shared/types/agent'
import type { AgentSteeringResult } from '../../../ports/agent-steering-service'
import type { PiModel } from '../pi-provider-catalog'
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
}

interface RegisteredPiLiveRun {
  readonly run: PiLiveRun
  readonly controller: AbortController
  readonly control: ReturnType<typeof createPiRunControl>
  steerTail: Promise<void>
}

const liveRuns = new Map<string, RegisteredPiLiveRun>()

export function registerPiLiveRun(run: PiLiveRun) {
  if (liveRuns.has(run.runId)) throw new Error(`Pi Run is already live: ${run.runId}`)
  const controller = new AbortController()
  const signal = run.signal ? AbortSignal.any([run.signal, controller.signal]) : controller.signal
  const registered: RegisteredPiLiveRun = {
    run,
    controller,
    control: createPiRunControl(run.session, signal, {
      routeThroughInputHook: run.routeThroughInputHook === true,
    }),
    steerTail: Promise.resolve(),
  }
  liveRuns.set(run.runId, registered)
  return () => {
    controller.abort()
    if (liveRuns.get(run.runId) === registered) liveRuns.delete(run.runId)
  }
}

export async function steerPiLiveRun(input: PiLiveRunSteeringInput): Promise<AgentSteeringResult> {
  const liveRun = liveRuns.get(input.runId)
  if (!liveRun) return { accepted: false, code: 'run_not_live' }
  const steering = liveRun.steerTail.then(async (): Promise<AgentSteeringResult> => {
    if (liveRuns.get(input.runId) !== liveRun) return { accepted: false, code: 'run_not_live' }
    if (!liveRun.run.session.isStreaming && !liveRun.run.session.isCompacting) {
      return { accepted: false, code: 'run_not_streaming' }
    }
    const delivery = await liveRun.control.steer({
      text: input.text,
      thinkingLevel: 'off',
      attachments: input.attachments,
      ...(input.visualizationContext ? { visualizationContext: input.visualizationContext } : {}),
    })
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
    return { accepted: true, receipt }
  })
  liveRun.steerTail = steering.then(
    () => undefined,
    () => undefined,
  )
  return steering
}
