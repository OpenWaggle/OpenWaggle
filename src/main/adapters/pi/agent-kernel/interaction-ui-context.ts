import { randomUUID } from 'node:crypto'
import type { ExtensionUIContext, ExtensionUIDialogOptions } from '@earendil-works/pi-coding-agent'
import type {
  AgentLoopConfirmInteraction,
  AgentLoopCustomInteraction,
  AgentLoopEditorInteraction,
  AgentLoopInputInteraction,
  AgentLoopInteractionBase,
  AgentLoopInteractionResponse,
  AgentLoopNotifyInteraction,
  AgentLoopNotifyLevel,
  AgentLoopSelectInteraction,
} from '@shared/types/agent-loop-interaction'
import type { SessionId } from '@shared/types/brand'
import type { AgentTransportEvent } from '@shared/types/stream'
import {
  type AgentLoopInteractionRequestInput,
  failAgentLoopInteraction,
  requestAgentLoopInteraction,
} from '../../../application/agent-loop-interaction-broker'

const CUSTOM_INTERACTION_UNSUPPORTED_MESSAGE =
  'Pi custom TUI interactions are not supported in OpenWaggle Electron. Use a typed OpenWaggle desktop interaction contribution instead.'

export interface PiInteractionUiContextInput {
  readonly sessionId: SessionId
  readonly runId: string
  readonly signal: AbortSignal
  readonly onEvent: (event: AgentTransportEvent) => void
}

function timeoutFields(opts: ExtensionUIDialogOptions | undefined) {
  return opts?.timeout !== undefined ? { timeoutMs: opts.timeout } : {}
}

function mergedSignal(input: {
  readonly runSignal: AbortSignal
  readonly interactionSignal?: AbortSignal
}) {
  if (!input.interactionSignal) return input.runSignal

  const controller = new AbortController()
  const abort = () => controller.abort()
  input.runSignal.addEventListener('abort', abort, { once: true })
  input.interactionSignal.addEventListener('abort', abort, { once: true })
  if (input.runSignal.aborted || input.interactionSignal.aborted) {
    controller.abort()
  }
  return controller.signal
}

function baseInteraction(input: {
  readonly context: PiInteractionUiContextInput
  readonly opts?: ExtensionUIDialogOptions
}): Omit<AgentLoopInteractionBase, 'kind'> {
  return {
    interactionId: randomUUID(),
    sessionId: input.context.sessionId,
    runId: input.context.runId,
    source: 'pi-ui',
    createdAt: Date.now(),
    ...timeoutFields(input.opts),
  }
}

async function requestInteraction(input: AgentLoopInteractionRequestInput) {
  return requestAgentLoopInteraction(input)
}

function selectedValue(response: AgentLoopInteractionResponse) {
  return response.kind === 'select' ? (response.selected ?? undefined) : undefined
}

function confirmedValue(response: AgentLoopInteractionResponse) {
  return response.kind === 'confirm' ? response.accepted : false
}

function textValue(response: AgentLoopInteractionResponse) {
  if (response.kind !== 'input' && response.kind !== 'editor') return undefined
  return response.value ?? undefined
}

function normalizeNotifyLevel(level: AgentLoopNotifyLevel | undefined) {
  return level ?? 'info'
}

export function createPiInteractionUiContext(
  context: PiInteractionUiContextInput,
  base: ExtensionUIContext,
): ExtensionUIContext {
  return {
    ...base,
    select: async (title, choices, opts) => {
      const interaction = {
        ...baseInteraction({ context, opts }),
        kind: 'select',
        title,
        choices: [...choices],
      } satisfies AgentLoopSelectInteraction
      const response = await requestInteraction({
        interaction,
        onEvent: context.onEvent,
        signal: mergedSignal({ runSignal: context.signal, interactionSignal: opts?.signal }),
      })
      return selectedValue(response)
    },
    confirm: async (title, message, opts) => {
      const interaction = {
        ...baseInteraction({ context, opts }),
        kind: 'confirm',
        title,
        message,
      } satisfies AgentLoopConfirmInteraction
      const response = await requestInteraction({
        interaction,
        onEvent: context.onEvent,
        signal: mergedSignal({ runSignal: context.signal, interactionSignal: opts?.signal }),
      })
      return confirmedValue(response)
    },
    input: async (title, placeholder, opts) => {
      const interaction = {
        ...baseInteraction({ context, opts }),
        kind: 'input',
        title,
        ...(placeholder !== undefined ? { placeholder } : {}),
      } satisfies AgentLoopInputInteraction
      const response = await requestInteraction({
        interaction,
        onEvent: context.onEvent,
        signal: mergedSignal({ runSignal: context.signal, interactionSignal: opts?.signal }),
      })
      return textValue(response)
    },
    notify: (message, level) => {
      const interaction = {
        ...baseInteraction({ context }),
        kind: 'notify',
        message,
        level: normalizeNotifyLevel(level),
      } satisfies AgentLoopNotifyInteraction
      void requestInteraction({ interaction, onEvent: context.onEvent, signal: context.signal })
    },
    editor: async (title, prefill) => {
      const interaction = {
        ...baseInteraction({ context }),
        kind: 'editor',
        title,
        ...(prefill !== undefined ? { prefill } : {}),
      } satisfies AgentLoopEditorInteraction
      const response = await requestInteraction({
        interaction,
        onEvent: context.onEvent,
        signal: context.signal,
      })
      return textValue(response)
    },
    custom: async <_T>() => {
      const interaction = {
        ...baseInteraction({ context }),
        kind: 'custom',
        renderer: {
          kind: 'pi-tui-custom',
          supported: false,
        },
      } satisfies AgentLoopCustomInteraction
      failAgentLoopInteraction({
        interaction,
        onEvent: context.onEvent,
        error: {
          code: 'custom-renderer-unavailable',
          message: CUSTOM_INTERACTION_UNSUPPORTED_MESSAGE,
        },
      })
      throw new Error(CUSTOM_INTERACTION_UNSUPPORTED_MESSAGE)
    },
  }
}
