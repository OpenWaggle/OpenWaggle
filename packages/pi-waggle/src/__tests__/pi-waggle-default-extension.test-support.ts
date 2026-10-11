import type {
  AgentEndEvent,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionToolContext,
  InputEvent,
  TurnEndEvent,
} from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { type Mock, vi } from 'vitest'
import type { PiWaggleModel } from '../extension.js'
import defaultPiWaggleExtension from '../extension.js'

const FIRST_PROVIDER_CHARACTER_INDEX = 0
const MODEL_ID_START_OFFSET = 1
const MAX_TURNS_SAFETY = 4
const PRIMARY_MODEL = 'openai/gpt-5.5'
const SECONDARY_MODEL = 'anthropic/claude-sonnet-4'

type RegisteredCommandOptions = Parameters<ExtensionAPI['registerCommand']>[1]
type RegisteredToolOptions = Parameters<ExtensionAPI['registerTool']>[0]

export function modelFor(modelReference: string): PiWaggleModel {
  const separatorIndex = modelReference.indexOf('/')
  if (separatorIndex <= FIRST_PROVIDER_CHARACTER_INDEX) {
    throw new Error(`Expected provider/model id, received ${modelReference}`)
  }

  return fromPartial<PiWaggleModel>({
    provider: modelReference.slice(FIRST_PROVIDER_CHARACTER_INDEX, separatorIndex),
    id: modelReference.slice(separatorIndex + MODEL_ID_START_OFFSET),
  })
}

export function waggleConfig() {
  return {
    mode: 'sequential',
    agents: [
      {
        label: 'Architect',
        model: PRIMARY_MODEL,
        roleDescription: 'Designs the implementation',
        color: 'blue',
      },
      {
        label: 'Reviewer',
        model: SECONDARY_MODEL,
        roleDescription: 'Reviews the implementation',
        color: 'amber',
      },
    ],
    stop: { primary: 'consensus', maxTurnsSafety: MAX_TURNS_SAFETY },
  } as const
}

export function assistantToolCallMessage(toolCallId: string): AgentEndEvent['messages'][number] {
  return fromPartial<AgentEndEvent['messages'][number]>({
    role: 'assistant',
    content: [{ type: 'toolCall', id: toolCallId, name: 'read', arguments: {} }],
  })
}

export function assistantTextMessage(text: string): AgentEndEvent['messages'][number] {
  return fromPartial<AgentEndEvent['messages'][number]>({
    role: 'assistant',
    content: [{ type: 'text', text }],
  })
}

export function toolResultMessage(toolCallId: string): TurnEndEvent['toolResults'][number] {
  return {
    role: 'toolResult',
    toolCallId,
    toolName: 'read',
    content: [{ type: 'text', text: 'ok' }],
    isError: false,
    timestamp: Date.now(),
  }
}

export function turnEndEvent(input: {
  readonly message: AgentEndEvent['messages'][number]
  readonly toolResults?: TurnEndEvent['toolResults']
}): TurnEndEvent {
  return fromPartial<TurnEndEvent>({
    type: 'turn_end',
    turnIndex: 0,
    message: input.message,
    toolResults: [...(input.toolResults ?? [])],
  })
}

export function inputImage(): NonNullable<InputEvent['images']>[number] {
  return { type: 'image', data: 'base64-image', mimeType: 'image/png' }
}

export function enabledModeStateEntry() {
  return {
    id: 'enabled-mode',
    parentId: null,
    timestamp: '2026-05-25T00:00:00.000Z',
    type: 'custom',
    customType: 'pi-waggle.mode-state',
    data: { enabled: true, config: waggleConfig(), updatedAt: 1 },
  }
}

export interface DefaultExtensionHarness {
  readonly commands: Map<string, RegisteredCommandOptions>
  readonly ctx: ExtensionCommandContext & ExtensionToolContext
  readonly eventHandlers: Map<string, (...args: unknown[]) => unknown>
  readonly sendMessage: Mock<ExtensionAPI['sendMessage']>
  readonly sendUserMessage: Mock<ExtensionAPI['sendUserMessage']>
  readonly setModel: Mock<ExtensionAPI['setModel']>
  readonly settle: (...attempts: readonly AgentEndEvent['messages'][]) => Promise<void>
  readonly tools: Map<string, RegisteredToolOptions>
}

/** The default extension loaded the way Pi loads it, with Pi's API and context faked. */
export function createHarness(
  input: { readonly branchEntries?: readonly unknown[] } = {},
): DefaultExtensionHarness {
  const commands = new Map<string, RegisteredCommandOptions>()
  const tools = new Map<string, RegisteredToolOptions>()
  const eventHandlers = new Map<string, (...args: unknown[]) => unknown>()
  const sendMessage = vi.fn<ExtensionAPI['sendMessage']>()
  const sendUserMessage = vi.fn<ExtensionAPI['sendUserMessage']>()
  const setModel = vi.fn<ExtensionAPI['setModel']>(async () => true)
  const pi = fromPartial<ExtensionAPI>({
    appendEntry: vi.fn(),
    getFlag: vi.fn(),
    on: vi.fn((eventName: string, handler: (...args: unknown[]) => unknown) => {
      eventHandlers.set(eventName, handler)
    }),
    registerCommand: vi.fn((name: string, options: RegisteredCommandOptions) => {
      commands.set(name, options)
    }),
    registerTool: vi.fn((tool: RegisteredToolOptions) => {
      tools.set(tool.name, tool)
    }),
    registerMessageRenderer: vi.fn(),
    sendMessage,
    sendUserMessage,
    setModel,
  })
  const currentModel = modelFor(PRIMARY_MODEL)
  const ctx = fromPartial<ExtensionCommandContext & ExtensionToolContext>({
    cwd: '/repo',
    hasUI: true,
    isIdle: () => true,
    model: currentModel,
    modelRegistry: {
      find: (provider: string, modelId: string) => modelFor(`${provider}/${modelId}`),
    },
    sessionManager: { getBranch: () => [...(input.branchEntries ?? [])] },
    ui: { notify: vi.fn(), setStatus: vi.fn(), setWorkingMessage: vi.fn() },
    waitForIdle: vi.fn(async () => undefined),
  })

  defaultPiWaggleExtension(pi)

  /** Ends a Pi run: one `agent_end` per attempt, then `agent_settled` once Pi is done with it. */
  async function settle(...attempts: readonly AgentEndEvent['messages'][]) {
    const agentEnd = eventHandlers.get('agent_end')
    const agentSettled = eventHandlers.get('agent_settled')
    if (!agentEnd || !agentSettled) throw new Error('Expected agent_end and agent_settled handlers')
    for (const messages of attempts) await agentEnd({ type: 'agent_end', messages }, ctx)
    await agentSettled({ type: 'agent_settled' }, ctx)
  }

  return { commands, ctx, eventHandlers, sendMessage, sendUserMessage, setModel, settle, tools }
}
