import type { ImageContent } from '@earendil-works/pi-ai'
import type { AgentSession } from '@earendil-works/pi-coding-agent'
import type { AgentKernelRunControl } from '../../../ports/agent-kernel-service'
import {
  buildAtomicVisualizationPrompt,
  buildPiPromptInput,
  stripAtomicVisualizationContext,
} from '../pi-runtime-input'
import { enqueueUserInputProjection } from './user-input-projection'

const PI_STEER_READY_POLL_MS = 20
const NOT_READY_FOR_STEERING = 'The active Pi session is not ready for steering.'

interface PiSteeringSession {
  readonly sessionManager: Pick<AgentSession['sessionManager'], 'appendCustomEntry' | 'getEntries'>
  readonly subscribe: AgentSession['subscribe']
  readonly isCompacting: AgentSession['isCompacting']
  readonly isStreaming: AgentSession['isStreaming']
  readonly model:
    | { readonly input: readonly NonNullable<AgentSession['model']>['input'][number][] }
    | undefined
  readonly prompt?: AgentSession['prompt']
  /** Pi's expanded-text steering contract: resolves to the exact queued text, or undefined when handled. */
  readonly steer: (
    text: string,
    images: ImageContent[] | undefined,
    transformExpandedText: (expandedText: string) => string,
  ) => Promise<string | undefined>
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

/** Pi's code for a `streamingOnly` prompt that arrived after the active turn ended. */
const AGENT_NOT_STREAMING = 'agent_not_streaming'

function isAgentNotStreaming(cause: unknown) {
  return cause instanceof Error && 'code' in cause && cause.code === AGENT_NOT_STREAMING
}

/**
 * Routes steering through Pi's input hook into the active turn only. Pi decides after its input
 * handlers ran, so the turn can end in between; `streamingOnly` makes Pi refuse then, rather than
 * start a new turn and report the steer as handled.
 */
async function promptIntoActiveTurn(
  session: Pick<PiSteeringSession, 'prompt'>,
  text: string,
  options: Omit<
    NonNullable<Parameters<AgentSession['prompt']>[1]>,
    'streamingBehavior' | 'streamingOnly'
  >,
) {
  try {
    if (!session.prompt) throw new Error('The active Pi session cannot route steering input.')
    return await session.prompt(text, {
      ...options,
      streamingBehavior: 'steer',
      streamingOnly: true,
    })
  } catch (cause) {
    if (isAgentNotStreaming(cause)) throw new Error(NOT_READY_FOR_STEERING, { cause })
    throw cause
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
        throw new Error(NOT_READY_FOR_STEERING)
      }
      const promptInput = buildPiPromptInput({ input: session.model?.input ?? ['text'] }, payload)
      const visualizationContext = promptInput.visualizationContext
      const transformExpandedText = visualizationContext
        ? (expandedText: string) =>
            buildAtomicVisualizationPrompt(visualizationContext, expandedText)
        : undefined
      const transformSteeringText =
        transformExpandedText ?? ((expandedText: string) => expandedText)
      const text = promptInput.text
      const images = promptInput.images.length > 0 ? [...promptInput.images] : undefined
      const minimumCreatedOrder = session.sessionManager.getEntries().length
      const cancelProjection = enqueueUserInputProjection(session, payload, signal)
      try {
        let durableText: string | undefined
        if (options.routeThroughInputHook) {
          durableText = await promptIntoActiveTurn(session, text, {
            ...(images ? { images } : {}),
            ...(transformExpandedText ? { transformExpandedText } : {}),
          })
        } else {
          durableText = await session.steer(text, images, transformSteeringText)
        }
        if (durableText === undefined) {
          cancelProjection()
          return { delivery: 'handled' }
        }
        return {
          delivery: 'queued',
          durableText: stripAtomicVisualizationContext(durableText),
          minimumCreatedOrder,
        }
      } catch (cause) {
        cancelProjection()
        throw cause
      }
    },
  }
}
