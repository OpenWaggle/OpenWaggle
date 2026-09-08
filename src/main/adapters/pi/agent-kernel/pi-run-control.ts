import type { AgentSession } from '@earendil-works/pi-coding-agent'
import type { AgentKernelRunControl } from '../../../ports/agent-kernel-service'
import {
  buildAtomicVisualizationPrompt,
  buildPiPromptInput,
  stripAtomicVisualizationContext,
} from '../pi-runtime-input'

const PI_STEER_READY_POLL_MS = 20

interface PiSteeringSession {
  readonly isCompacting: AgentSession['isCompacting']
  readonly isStreaming: AgentSession['isStreaming']
  readonly model:
    | { readonly input: readonly NonNullable<AgentSession['model']>['input'][number][] }
    | undefined
  readonly prompt?: AgentSession['prompt']
  readonly steer: AgentSession['steer']
}

interface PiRunControlOptions {
  readonly routeThroughInputHook?: boolean
}

function abortError() {
  return new DOMException('The active agent run was cancelled.', 'AbortError')
}

async function waitForCompaction(session: PiSteeringSession, signal: AbortSignal) {
  while (session.isCompacting) {
    if (signal.aborted) throw abortError()
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timeout)
        reject(abortError())
      }
      const timeout = setTimeout(() => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      }, PI_STEER_READY_POLL_MS)
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }
}

export function createPiRunControl(
  session: PiSteeringSession,
  signal: AbortSignal,
  options: PiRunControlOptions = {},
): AgentKernelRunControl {
  return {
    steer: async (payload) => {
      await waitForCompaction(session, signal)
      if (signal.aborted) throw abortError()
      if (!session.isStreaming) {
        throw new Error('The active Pi session is not ready for steering.')
      }
      const promptInput = buildPiPromptInput({ input: session.model?.input ?? ['text'] }, payload)
      const visualizationContext = promptInput.visualizationContext
      const transformExpandedText = visualizationContext
        ? (expandedText: string) =>
            buildAtomicVisualizationPrompt(visualizationContext, expandedText)
        : undefined
      const text = promptInput.text
      const images = promptInput.images.length > 0 ? [...promptInput.images] : undefined
      if (options.routeThroughInputHook) {
        if (!session.prompt) throw new Error('The active Pi session cannot route steering input.')
        const durableText = await session.prompt(text, {
          ...(images ? { images } : {}),
          ...(transformExpandedText ? { transformExpandedText } : {}),
          streamingBehavior: 'steer',
        })
        return durableText === undefined
          ? { delivery: 'handled' }
          : { delivery: 'queued', durableText: stripAtomicVisualizationContext(durableText) }
      }
      const durableText = transformExpandedText
        ? await session.steer(text, images, transformExpandedText)
        : await session.steer(text, images)
      return { delivery: 'queued', durableText: stripAtomicVisualizationContext(durableText) }
    },
  }
}
