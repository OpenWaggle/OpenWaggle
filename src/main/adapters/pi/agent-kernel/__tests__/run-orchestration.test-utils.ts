import type { HydratedAgentSendPayload } from '@shared/types/agent'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { WaggleConfig } from '@shared/types/waggle'
import { isRecord } from '@shared/utils/validation'
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
  readonly modelReference: string
  readonly extensionFactories?: readonly ((pi: FakePi) => void)[]
}

export interface FakePi {
  readonly on: (event: 'agent_end', handler: AgentEndHandler) => void
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
  readonly isStreaming: boolean
  readonly sessionManager: {
    readonly buildSessionContext: () => { readonly messages: readonly unknown[] }
    readonly appendCustomEntry: (customType: string, data?: unknown) => string
    readonly getEntries: () => readonly unknown[]
    readonly getLeafId: () => null
  }
  readonly abort: () => Promise<undefined>
  readonly prompt: (text: string) => Promise<void>
  readonly sendCustomMessage: (message: unknown, options: unknown) => Promise<void>
  readonly setModel: (model: FakeModel) => Promise<void>
  readonly subscribe: (listener: unknown) => () => void
}

export const SESSION_ID = SessionId('session-1')
export const PRIMARY_MODEL = SupportedModelId('openai/gpt-5.5')
export const SECONDARY_MODEL = SupportedModelId('anthropic/claude-sonnet-4')

export function modelFromReference(modelReference: string): FakeModel {
  const [provider = 'openai', id = 'gpt-5.5'] = modelReference.split('/')
  return {
    id,
    provider,
    input: ['text', 'image'],
    availableThinkingLevels: ['off', 'medium', 'high'],
  }
}

export function payload(
  text = 'Review the architecture',
  overrides: Partial<HydratedAgentSendPayload> = {},
): HydratedAgentSendPayload {
  return { text, thinkingLevel: 'high', attachments: [], ...overrides }
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

function shouldTriggerTurn(options: unknown) {
  return isRecord(options) && options.triggerTurn === true
}

export function createFakePi(
  recordMessage: (message: unknown) => void = () => undefined,
): FakePiHarness {
  let agentEndHandler: AgentEndHandler | null = null
  const modelRegistry: FakeModelRegistry = {
    find: (provider, modelId) => modelFromReference(`${provider}/${modelId}`),
  }
  const pi: FakePi = {
    on: vi.fn((_event, handler) => {
      agentEndHandler = handler
    }),
    sendMessage: vi.fn((message, options) => {
      if (shouldTriggerTurn(options)) {
        recordMessage(message)
        recordMessage(assistantMessage('second turn'))
        void agentEndHandler?.(
          { messages: [message, assistantMessage('second turn')] },
          { modelRegistry },
        )
      }
    }),
    setModel: vi.fn(async () => true),
  }
  return { pi, getAgentEndHandler: () => agentEndHandler, modelRegistry }
}

export function createFakeSession(
  agentEndHandler: () => AgentEndHandler | null,
  messages: unknown[] = [],
): FakeRunSession {
  const unsubscribe = vi.fn()
  return {
    sessionId: 'pi-session-1',
    sessionFile: '/repo/.pi/session.jsonl',
    agent: {
      state: { messages },
      waitForIdle: vi.fn(async () => undefined),
      hasQueuedMessages: vi.fn(() => false),
    },
    isCompacting: false,
    isStreaming: false,
    sessionManager: {
      appendCustomEntry: vi.fn(() => 'mode-state-entry'),
      buildSessionContext: () => ({ messages: [] }),
      getEntries: () => [],
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
    subscribe: vi.fn(() => unsubscribe),
  }
}

export function waggleConfig(): WaggleConfig {
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
    stop: { primary: 'consensus', maxTurnsSafety: 4 },
  }
}
