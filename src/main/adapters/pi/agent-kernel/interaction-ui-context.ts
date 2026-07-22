import { randomUUID } from 'node:crypto'
import type { ExtensionUIContext } from '@earendil-works/pi-coding-agent'
import { OPENWAGGLE_AGENT_LOOP } from '@shared/constants/agent-loop'
import type {
  AgentLoopConfirmInteraction,
  AgentLoopCustomInteraction,
  AgentLoopEditorInteraction,
  AgentLoopInputInteraction,
  AgentLoopInteractionBase,
  AgentLoopInteractionResponse,
  AgentLoopNotifyInteraction,
  AgentLoopSelectInteraction,
} from '@shared/types/agent-loop-interaction'
import type { SessionId } from '@shared/types/brand'
import type { AgentTransportEvent } from '@shared/types/stream'
import {
  type AgentLoopInteractionRequestInput,
  requestAgentLoopInteraction,
} from '../../../application/agent-loop-interaction-broker'

type DesktopInteractionUiOverrideKey = 'select' | 'confirm' | 'input' | 'notify' | 'editor'
type DesktopInteractionUiOverrides = Pick<ExtensionUIContext, DesktopInteractionUiOverrideKey>
type PiCustomInteractionFactory = Parameters<ExtensionUIContext['custom']>[0]
type PiCustomInteractionOptions = Parameters<ExtensionUIContext['custom']>[1]
type PiDialogOptions = Parameters<ExtensionUIContext['select']>[2]
type PiNotifyLevel = Parameters<ExtensionUIContext['notify']>[1]

export interface PiInteractionUiContextInput {
  readonly sessionId: SessionId
  readonly runId: string
  readonly signal: AbortSignal
  readonly onEvent: (event: AgentTransportEvent) => void
}

function timeoutFields(opts: PiDialogOptions) {
  return opts?.timeout !== undefined ? { timeoutMs: opts.timeout } : {}
}

function mergedSignal(input: {
  readonly runSignal: AbortSignal
  readonly interactionSignal?: AbortSignal
}) {
  if (!input.interactionSignal) return input.runSignal
  return AbortSignal.any([input.runSignal, input.interactionSignal])
}

function baseInteraction(input: {
  readonly context: PiInteractionUiContextInput
  readonly opts?: PiDialogOptions
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

function normalizeNotifyLevel(level: PiNotifyLevel) {
  return level ?? 'info'
}

function customRendererFields(
  factory: PiCustomInteractionFactory,
  options: PiCustomInteractionOptions,
): AgentLoopCustomInteraction['renderer'] {
  return {
    kind: 'pi-tui-custom',
    supported: false,
    ...(factory.name.trim().length > 0 ? { factoryName: factory.name } : {}),
    ...(options?.overlay !== undefined ? { overlay: options.overlay } : {}),
  }
}

async function requestCustomInteraction(input: {
  readonly context: PiInteractionUiContextInput
  readonly factory: PiCustomInteractionFactory
  readonly options: PiCustomInteractionOptions
}) {
  const interaction = {
    ...baseInteraction({ context: input.context }),
    kind: 'custom',
    customType: OPENWAGGLE_AGENT_LOOP.PI_TUI_CUSTOM_INTERACTION_TYPE,
    renderer: customRendererFields(input.factory, input.options),
  } satisfies AgentLoopCustomInteraction
  const response = await requestInteraction({
    interaction,
    onEvent: input.context.onEvent,
    signal: input.context.signal,
  })
  return response.kind === 'custom' ? response.value : null
}

function createDesktopInteractionUiOverrides(
  context: PiInteractionUiContextInput,
): DesktopInteractionUiOverrides {
  return {
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
  } satisfies DesktopInteractionUiOverrides
}

export function createPiInteractionUiContext(
  context: PiInteractionUiContextInput,
  base: ExtensionUIContext,
): ExtensionUIContext {
  return Object.assign({}, base, createDesktopInteractionUiOverrides(context), {
    custom: (factory: PiCustomInteractionFactory, options: PiCustomInteractionOptions) =>
      requestCustomInteraction({ context, factory, options }),
  })
}
