import type { HydratedAgentSendPayload } from '@shared/types/agent'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { WaggleConfig } from '@shared/types/waggle'
import { Schema } from '@shared/schema'
import { vi } from 'vitest'

interface AgentEndEvent {
  readonly messages: readonly unknown[]
}

export interface FakeModelRegistry {
  readonly find: (provider: string, modelId: string) => FakeModel | null
}

interface FakeExtensionContext {
  readonly modelRegistry: FakeModelRegistry
}

export type AgentEndHandler = (
  event: AgentEndEvent,
  ctx: FakeExtensionContext,
) => Promise<void> | void

export interface FakeModel {
  readonly id: string
  readonly provider: string
  readonly input: readonly ('text' | 'image')[]
  readonly availableThinkingLevels: readonly string[]
}

export interface RuntimeFactoryInput {
  readonly projectPath: string
  readonly modelReference: string
  readonly skillToggles?: Readonly<Record<string, boolean>>
  readonly enabledOpenWaggleExtensionPackagePaths?: readonly string[]
  readonly enabledOpenWaggleExtensionResourceRoots?: readonly {
    readonly packagePath: string
    readonly resourceRoot: string
  }[]
  readonly extensionFactories?: readonly ((pi: FakePi) => void)[]
  readonly trustedExtensionFactories?: readonly ((pi: FakePi) => void)[]
  readonly systemPromptAppendices?: readonly string[]
}

export function installRuntimeFactories(input: RuntimeFactoryInput, pi: FakePi) {
  for (const factory of [
    ...(input.extensionFactories ?? []),
    ...(input.trustedExtensionFactories ?? []),
  ]) {
    factory(pi)
  }
}

export function fakeRuntimeServices() {
  return {
    diagnostics: { records: [] },
    resourceLoader: {
      getExtensions: () => ({ errors: [] }),
    },
  }
}

export interface FakePi {
  readonly on: (event: 'agent_end' | 'agent_settled', handler: AgentEndHandler) => void
  readonly sendMessage: (message: unknown, options: unknown) => void
  readonly setModel: (model: FakeModel) => Promise<boolean>
}

export interface FakePiHarness {
  readonly pi: FakePi
  readonly getAgentEndHandler: () => AgentEndHandler | null
  readonly modelRegistry: FakeModelRegistry
}

export interface FakeRunSession {
  readonly sessionId: string
  readonly sessionFile: string
  readonly agent: {
    readonly state: { readonly messages: unknown[] }
    readonly waitForIdle: () => Promise<void>
    readonly hasQueuedMessages: () => boolean
  }
  readonly isCompacting: boolean
  readonly extensionRunner: {
    readonly onError: () => () => void
    readonly getRegisteredCommands: () => readonly never[]
  }
  readonly isStreaming: boolean
  readonly resourceLoader: {
    readonly getExtensions: () => { readonly extensions: readonly never[] }
  }
  readonly sessionManager: {
    readonly buildSessionContext: () => { readonly messages: readonly unknown[] }
    readonly appendCustomEntry: (customType: string, data?: unknown) => string
    readonly getEntries: () => readonly unknown[]
    readonly getBranch: () => readonly never[]
    readonly getLeafId: () => null
  }
  readonly abort: () => Promise<undefined>
  readonly prompt: (text: string) => Promise<void>
  readonly sendCustomMessage: (message: unknown, options: unknown) => Promise<void>
  readonly sendUserMessage: (content: unknown, options: unknown) => Promise<void>
  readonly setModel: (model: FakeModel) => Promise<void>
  readonly subscribe: (listener: unknown) => () => void
}

export const SESSION_ID = SessionId('session-1')
export const PRIMARY_MODEL = SupportedModelId('openai/gpt-5.5')
export const SECONDARY_MODEL = SupportedModelId('anthropic/claude-sonnet-4')

export function modelFromReference(modelReference: string) {
  const [provider = 'openai', id = 'gpt-5.5'] = modelReference.split('/')
  const model: FakeModel = {
    id,
    provider,
    input: ['text', 'image'],
    availableThinkingLevels: ['off', 'medium', 'high'],
  }
  return model
}

export function payload(
  text = 'Review the architecture',
  overrides: Partial<HydratedAgentSendPayload> = {},
) {
  const result: HydratedAgentSendPayload = { text, attachments: [], ...overrides }
  return result
}

export function sessionDetail() {
  return {
    id: SESSION_ID,
    title: 'Run orchestration',
    projectPath: '/repo',
    piSessionId: 'pi-session-1',
    piSessionFile: '/repo/.pi/session.jsonl',
    messages: [],
    createdAt: 1,
    updatedAt: 2,
  }
}

export function assistantMessage(text: string) {
  return {
    role: 'assistant',
    api: 'openai-completions',
    provider: 'openai',
    model: 'gpt-5.5',
    content: [{ type: 'text', text }],
    stopReason: 'stop',
  }
}

const triggerTurnOptionsSchema = Schema.Struct({ triggerTurn: Schema.Literal(true) })

export function shouldTriggerTurn(options: unknown) {
  return Schema.is(triggerTurnOptionsSchema)(options)
}

export function createFakePi(recordMessage: (message: unknown) => void = () => undefined) {
  const handlers = new Map<string, AgentEndHandler>()
  // Pi settles a turn after its agent_end, once no retry or continuation follows; the Waggle
  // loop advances on that.
  const agentEndHandler: AgentEndHandler = async (event, ctx) => {
    await handlers.get('agent_end')?.(event, ctx)
    await handlers.get('agent_settled')?.(event, ctx)
  }
  const modelRegistry: FakeModelRegistry = {
    find: (provider, modelId) => modelFromReference(`${provider}/${modelId}`),
  }
  const pi: FakePi = {
    on: vi.fn((event, handler) => {
      handlers.set(event, handler)
    }),
    sendMessage: vi.fn((message, options) => {
      if (shouldTriggerTurn(options)) {
        recordMessage(message)
        recordMessage(assistantMessage('second turn'))
        void agentEndHandler(
          { messages: [message, assistantMessage('second turn')] },
          { modelRegistry },
        )
      }
    }),
    setModel: vi.fn(async () => true),
  }
  const harness: FakePiHarness = {
    pi,
    getAgentEndHandler: () => (handlers.size > 0 ? agentEndHandler : null),
    modelRegistry,
  }
  return harness
}

export function createFakeSession(
  agentEndHandler: () => AgentEndHandler | null,
  messages: unknown[] = [],
) {
  const unsubscribe = vi.fn()
  const session: FakeRunSession = {
    sessionId: 'pi-session-1',
    sessionFile: '/repo/.pi/session.jsonl',
    agent: {
      state: { messages },
      waitForIdle: vi.fn(async () => undefined),
      hasQueuedMessages: vi.fn(() => false),
    },
    isCompacting: false,
    isStreaming: false,
    extensionRunner: { onError: vi.fn(() => () => undefined), getRegisteredCommands: () => [] },
    resourceLoader: { getExtensions: () => ({ extensions: [] }) },
    sessionManager: {
      appendCustomEntry: vi.fn(() => 'mode-state-entry'),
      buildSessionContext: () => ({ messages: [] }),
      getEntries: () => [],
      getBranch: () => [],
      getLeafId: () => null,
    },
    abort: vi.fn(async () => undefined),
    prompt: vi.fn(async (text: string) => {
      messages.push(assistantMessage(`response to ${text}`))
    }),
    setModel: vi.fn(async () => undefined),
    sendCustomMessage: vi.fn(async (message: unknown, options: unknown) => {
      messages.push(message)
      if (shouldTriggerTurn(options)) {
        messages.push(assistantMessage('first turn'))
        await agentEndHandler()?.(
          { messages: [message, assistantMessage('first turn')] },
          {
            modelRegistry: {
              find: (provider, modelId) => modelFromReference(`${provider}/${modelId}`),
            },
          },
        )
      }
    }),
    sendUserMessage: vi.fn(async () => undefined),
    subscribe: vi.fn(() => unsubscribe),
  }
  return session
}

export function waggleConfig() {
  const config: WaggleConfig = {
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
    stop: { primary: 'consensus', maxTurnsSafety: 4 },
  }
  return config
}
