import type {
  AgentEndEvent,
  ExtensionAPI,
  ExtensionCommandContext,
  InputEvent,
  TurnEndEvent,
} from '@mariozechner/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import type { PiWaggleModel } from '../extension'
import defaultPiWaggleExtension from '../extension'

const FIRST_PROVIDER_CHARACTER_INDEX = 0
const MODEL_ID_START_OFFSET = 1
const MAX_TURNS_SAFETY = 4
const PRIMARY_MODEL = 'openai/gpt-5.5'
const SECONDARY_MODEL = 'anthropic/claude-sonnet-4'

type RegisteredCommandOptions = Parameters<ExtensionAPI['registerCommand']>[1]

function modelFor(modelReference: string): PiWaggleModel {
  const separatorIndex = modelReference.indexOf('/')
  if (separatorIndex <= FIRST_PROVIDER_CHARACTER_INDEX) {
    throw new Error(`Expected provider/model id, received ${modelReference}`)
  }

  return fromPartial<PiWaggleModel>({
    provider: modelReference.slice(FIRST_PROVIDER_CHARACTER_INDEX, separatorIndex),
    id: modelReference.slice(separatorIndex + MODEL_ID_START_OFFSET),
  })
}

function waggleConfig() {
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

function assistantToolCallMessage(toolCallId: string): AgentEndEvent['messages'][number] {
  return fromPartial<AgentEndEvent['messages'][number]>({
    role: 'assistant',
    content: [{ type: 'toolCall', id: toolCallId, name: 'read', arguments: {} }],
  })
}

function assistantTextMessage(text: string): AgentEndEvent['messages'][number] {
  return fromPartial<AgentEndEvent['messages'][number]>({
    role: 'assistant',
    content: [{ type: 'text', text }],
  })
}

function toolResultMessage(toolCallId: string): TurnEndEvent['toolResults'][number] {
  return {
    role: 'toolResult',
    toolCallId,
    toolName: 'read',
    content: [{ type: 'text', text: 'ok' }],
    isError: false,
    timestamp: Date.now(),
  }
}

function turnEndEvent(input: {
  readonly message: AgentEndEvent['messages'][number]
  readonly toolResults?: TurnEndEvent['toolResults']
}): TurnEndEvent {
  return {
    type: 'turn_end',
    turnIndex: 0,
    message: input.message,
    toolResults: [...(input.toolResults ?? [])],
  }
}

function inputImage(): NonNullable<InputEvent['images']>[number] {
  return { type: 'image', data: 'base64-image', mimeType: 'image/png' }
}

function enabledModeStateEntry() {
  return {
    id: 'enabled-mode',
    parentId: null,
    timestamp: '2026-05-25T00:00:00.000Z',
    type: 'custom',
    customType: 'pi-waggle.mode-state',
    data: { enabled: true, config: waggleConfig(), updatedAt: 1 },
  }
}

function createHarness(input: { readonly branchEntries?: readonly unknown[] } = {}) {
  const commands = new Map<string, RegisteredCommandOptions>()
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
    registerMessageRenderer: vi.fn(),
    sendMessage,
    sendUserMessage,
    setModel,
  })
  const currentModel = modelFor(PRIMARY_MODEL)
  const ctx = fromPartial<ExtensionCommandContext>({
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
  return { commands, ctx, eventHandlers, sendMessage, sendUserMessage }
}

describe('pi-waggle default extension runtime flow', () => {
  it('preserves original image context when rewriting automatic Waggle turns', async () => {
    const image = inputImage()
    const harness = createHarness({ branchEntries: [enabledModeStateEntry()] })
    const input = harness.eventHandlers.get('input')
    const context = harness.eventHandlers.get('context')
    if (!input) throw new Error('Expected input handler')
    if (!context) throw new Error('Expected context handler')

    const inputResult = await input(
      { type: 'input', source: 'interactive', text: 'Inspect this screenshot', images: [image] },
      harness.ctx,
    )
    const contextResult = context(
      {
        type: 'context',
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Inspect this screenshot' }, image],
          },
        ],
      },
      harness.ctx,
    )

    expect(inputResult).toEqual({ action: 'continue' })
    expect(contextResult).toEqual({
      messages: [
        {
          role: 'user',
          content: [
            expect.objectContaining({
              type: 'text',
              text: expect.stringContaining('Inspect this screenshot'),
            }),
            image,
          ],
        },
      ],
    })
  })

  it('steers active Waggle turns instead of letting Pi reject concurrent user input', async () => {
    const harness = createHarness()
    const waggleCommand = harness.commands.get('waggle')
    const input = harness.eventHandlers.get('input')
    const turnEnd = harness.eventHandlers.get('turn_end')
    if (!waggleCommand) throw new Error('Expected /waggle command to be registered')
    if (!input) throw new Error('Expected input handler')
    if (!turnEnd) throw new Error('Expected turn_end handler')

    await waggleCommand.handler('code-review Review this migration', harness.ctx)
    harness.sendUserMessage.mockClear()

    const result = await input(
      { type: 'input', source: 'interactive', text: 'stop waggle and give me a summary' },
      harness.ctx,
    )

    expect(result).toEqual({ action: 'handled' })
    expect(harness.sendUserMessage).toHaveBeenCalledWith('stop waggle and give me a summary', {
      deliverAs: 'steer',
    })

    harness.sendMessage.mockClear()
    harness.sendUserMessage.mockClear()
    vi.useFakeTimers()
    try {
      await turnEnd(
        turnEndEvent({ message: assistantTextMessage('Stopped with summary.') }),
        harness.ctx,
      )
      await vi.runOnlyPendingTimersAsync()
      expect(harness.sendMessage).not.toHaveBeenCalled()
      expect(harness.sendUserMessage).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('waits for tool-using Pi turns to finish before scheduling the next Waggle turn', async () => {
    const harness = createHarness()
    const waggleCommand = harness.commands.get('waggle')
    const turnEnd = harness.eventHandlers.get('turn_end')
    if (!waggleCommand) throw new Error('Expected /waggle command to be registered')
    if (!turnEnd) throw new Error('Expected turn_end handler')

    await waggleCommand.handler('code-review Review this migration', harness.ctx)
    harness.sendMessage.mockClear()
    harness.sendUserMessage.mockClear()

    await turnEnd(
      turnEndEvent({
        message: assistantToolCallMessage('tool-1'),
        toolResults: [toolResultMessage('tool-1')],
      }),
      harness.ctx,
    )

    expect(harness.sendMessage).not.toHaveBeenCalled()
    expect(harness.sendUserMessage).not.toHaveBeenCalled()

    vi.useFakeTimers()
    try {
      await turnEnd(
        turnEndEvent({ message: assistantTextMessage('Done after reading.') }),
        harness.ctx,
      )

      expect(harness.sendMessage).not.toHaveBeenCalled()
      expect(harness.sendUserMessage).not.toHaveBeenCalled()

      await vi.runOnlyPendingTimersAsync()

      expect(harness.sendMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({ customType: 'pi-waggle.turn', display: true }),
        { triggerTurn: false },
      )
      expect(harness.sendUserMessage).toHaveBeenLastCalledWith(
        'Continue Waggle turn 2 as Reviewer.',
      )
    } finally {
      vi.useRealTimers()
    }
  })
})
