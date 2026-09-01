import type { AgentSession } from '@earendil-works/pi-coding-agent'
import type { HydratedAttachment, InlineVisualizationContext } from '@shared/types/agent'
import type { AgentSteeringResult } from '../../../ports/agent-steering-service'
import type { PiModel } from '../pi-provider-catalog'
import { buildPiPromptInput } from '../pi-runtime-input'

interface PiLiveRun {
  readonly runId: string
  readonly session: AgentSession
  readonly model: PiModel
}

export interface PiLiveRunSteeringInput {
  readonly runId: string
  readonly text: string
  readonly attachments: readonly HydratedAttachment[]
  readonly visualizationContext?: InlineVisualizationContext
}

const liveRuns = new Map<string, PiLiveRun>()

export function registerPiLiveRun(run: PiLiveRun) {
  if (liveRuns.has(run.runId)) throw new Error(`Pi Run is already live: ${run.runId}`)
  liveRuns.set(run.runId, run)
  return () => {
    if (liveRuns.get(run.runId) === run) liveRuns.delete(run.runId)
  }
}

export async function steerPiLiveRun(input: PiLiveRunSteeringInput): Promise<AgentSteeringResult> {
  const liveRun = liveRuns.get(input.runId)
  if (!liveRun) return { accepted: false, code: 'run_not_live' }
  if (!liveRun.session.isStreaming) return { accepted: false, code: 'run_not_streaming' }

  const prompt = buildPiPromptInput(liveRun.model, {
    text: input.text,
    thinkingLevel: 'off',
    attachments: input.attachments,
    ...(input.visualizationContext ? { visualizationContext: input.visualizationContext } : {}),
  })
  const steeringText = [prompt.visualizationContext, prompt.text].filter(Boolean).join('\n\n')
  await liveRun.session.steer(
    steeringText,
    prompt.images.length > 0 ? [...prompt.images] : undefined,
  )
  return { accepted: true }
}
