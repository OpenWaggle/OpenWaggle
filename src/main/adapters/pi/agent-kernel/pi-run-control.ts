import type { AgentSession } from '@earendil-works/pi-coding-agent'
import type { AgentKernelRunControl } from '../../../ports/agent-kernel-service'
import { buildAtomicVisualizationPrompt, buildPiPromptInput } from '../pi-runtime-input'

const PI_STEER_READY_POLL_MS = 20

interface PiSteeringSession {
  readonly isCompacting: AgentSession['isCompacting']
  readonly isStreaming: AgentSession['isStreaming']
  readonly model:
    | { readonly input: readonly NonNullable<AgentSession['model']>['input'][number][] }
    | undefined
  readonly sendUserMessage: AgentSession['sendUserMessage']
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
): AgentKernelRunControl {
  return {
    steer: async (payload) => {
      await waitForCompaction(session, signal)
      if (signal.aborted) throw abortError()
      if (!session.isStreaming) {
        throw new Error('The active Pi session is not ready for steering.')
      }
      const promptInput = buildPiPromptInput({ input: session.model?.input ?? ['text'] }, payload)
      const text = promptInput.visualizationContext
        ? buildAtomicVisualizationPrompt(promptInput.visualizationContext, promptInput.text)
        : promptInput.text
      const content =
        promptInput.images.length > 0
          ? [...(text ? [{ type: 'text' as const, text }] : []), ...promptInput.images]
          : text
      await session.sendUserMessage(content, { deliverAs: 'steer' })
    },
  }
}
