import type { ExtensionAPI, ExtensionCommandContext } from '@mariozechner/pi-coding-agent'
import { WAGGLE_INHERIT_MODEL } from '@openwaggle/waggle-core'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'

const { userHomeDir } = vi.hoisted(() => ({ userHomeDir: '/tmp/pi-waggle-package-home' }))

vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:os')>()),
  homedir: () => userHomeDir,
}))

import type { PiWaggleModel } from '../extension'
import defaultPiWaggleExtension from '../extension'
import { latestPiWaggleModeStateFromEntries } from '../mode-state'

const FIRST_PROVIDER_CHARACTER_INDEX = 0
const MODEL_ID_START_OFFSET = 1
const MAX_TURNS_SAFETY = 4
const PRIMARY_MODEL = 'openai/gpt-5.5'
const SECONDARY_MODEL = 'anthropic/claude-sonnet-4'

type RegisteredCommandOptions = Parameters<ExtensionAPI['registerCommand']>[1]

function config() {
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

function createPackageLoadHarness(input: { readonly resolveCurrentModel?: boolean } = {}) {
  const commands = new Map<string, RegisteredCommandOptions>()
  const eventHandlers = new Map<string, (...args: unknown[]) => unknown>()
  const appendedEntries: Array<{ readonly customType: string; readonly data: unknown }> = []
  const sendMessage = vi.fn<ExtensionAPI['sendMessage']>()
  const sendUserMessage = vi.fn<ExtensionAPI['sendUserMessage']>()
  const setModel = vi.fn<ExtensionAPI['setModel']>(async () => true)
  const pi = fromPartial<ExtensionAPI>({
    appendEntry: vi.fn((customType: string, data?: unknown) => {
      appendedEntries.push({ customType, data })
    }),
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
  const resolveCurrentModel = input.resolveCurrentModel ?? true
  const ctx = fromPartial<ExtensionCommandContext>({
    cwd: '/repo',
    hasUI: true,
    isIdle: () => true,
    model: currentModel,
    modelRegistry: {
      find: (provider: string, modelId: string) =>
        resolveCurrentModel && provider === currentModel.provider && modelId === currentModel.id
          ? currentModel
          : undefined,
    },
    sessionManager: {
      getBranch: () => [],
    },
    ui: {
      notify: vi.fn(),
      select: vi.fn(async () => 'code-review'),
      setStatus: vi.fn(),
      setWorkingMessage: vi.fn(),
    },
    waitForIdle: vi.fn(async () => undefined),
  })

  return {
    appendedEntries,
    commands,
    ctx,
    eventHandlers,
    pi,
    sendMessage,
    sendUserMessage,
    setModel,
  }
}

describe('pi-waggle package extension', () => {
  it('restores latest branch-scoped mode state from Pi custom entries', () => {
    const state = latestPiWaggleModeStateFromEntries([
      {
        id: 'first',
        parentId: null,
        timestamp: '2026-05-19T10:00:00.000Z',
        type: 'custom',
        customType: 'pi-waggle.mode-state',
        data: { enabled: true, config: config(), updatedAt: 1 },
      },
      {
        id: 'second',
        parentId: 'first',
        timestamp: '2026-05-19T10:01:00.000Z',
        type: 'custom',
        customType: 'pi-waggle.mode-state',
        data: { enabled: false, updatedAt: 2 },
      },
    ])

    expect(state).toEqual({ enabled: false, updatedAt: 2 })
  })

  it('loads as a real Pi extension with commands and renderers', async () => {
    const harness = createPackageLoadHarness()

    defaultPiWaggleExtension(harness.pi)

    expect(harness.pi.registerCommand).toHaveBeenCalledWith('waggle', expect.any(Object))
    expect(harness.pi.registerCommand).toHaveBeenCalledWith('standard', expect.any(Object))
    expect(harness.pi.registerMessageRenderer).toHaveBeenCalledWith(
      'pi-waggle.turn',
      expect.any(Function),
    )
    const waggleCommand = harness.commands.get('waggle')
    if (!waggleCommand) throw new Error('Expected /waggle command to be registered')

    await waggleCommand.handler('code-review Review this migration', harness.ctx)

    expect(harness.appendedEntries).toEqual([
      {
        customType: 'pi-waggle.mode-state',
        data: expect.objectContaining({
          enabled: true,
          presetId: 'code-review',
          config: expect.objectContaining({
            agents: [
              expect.objectContaining({ model: WAGGLE_INHERIT_MODEL }),
              expect.objectContaining({ model: WAGGLE_INHERIT_MODEL }),
            ],
          }),
        }),
      },
    ])
    expect(harness.setModel).toHaveBeenCalledWith(modelFor(PRIMARY_MODEL))
    expect(harness.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ customType: 'pi-waggle.user-request', display: true }),
      { triggerTurn: false },
    )
    expect(harness.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ customType: 'pi-waggle.turn', display: true }),
      { triggerTurn: false },
    )
    expect(harness.sendUserMessage).toHaveBeenCalledWith('Review this migration')
    const context = harness.eventHandlers.get('context')
    if (!context) throw new Error('Expected context handler')
    const contextResult = context(
      {
        type: 'context',
        messages: [
          {
            role: 'custom',
            customType: 'pi-waggle.user-request',
            content: 'Review this migration',
            display: true,
          },
          {
            role: 'custom',
            customType: 'pi-waggle.turn',
            content: 'internal display only',
            display: true,
          },
          { role: 'user', content: [{ type: 'text', text: 'Review this migration' }] },
        ],
      },
      harness.ctx,
    )
    expect(contextResult).toEqual({
      messages: [
        {
          role: 'user',
          content: [
            expect.objectContaining({
              type: 'text',
              text: expect.stringContaining('You are "Architect".'),
            }),
          ],
        },
      ],
    })
  })

  it('starts the next Waggle turn automatically after the current Pi run settles', async () => {
    const harness = createPackageLoadHarness()
    defaultPiWaggleExtension(harness.pi)
    const waggleCommand = harness.commands.get('waggle')
    const turnEnd = harness.eventHandlers.get('turn_end')
    if (!waggleCommand) throw new Error('Expected /waggle command to be registered')
    if (!turnEnd) throw new Error('Expected turn_end handler')

    await waggleCommand.handler('code-review Review this migration', harness.ctx)
    harness.sendMessage.mockClear()
    harness.sendUserMessage.mockClear()

    vi.useFakeTimers()
    try {
      await turnEnd(
        {
          type: 'turn_end',
          turnIndex: 0,
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'I found one concern.' }],
          },
          toolResults: [],
        },
        harness.ctx,
      )

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

  it('does not enable Waggle mode when the selected model is unavailable', async () => {
    const harness = createPackageLoadHarness({ resolveCurrentModel: false })
    defaultPiWaggleExtension(harness.pi)
    const waggleCommand = harness.commands.get('waggle')
    if (!waggleCommand) throw new Error('Expected /waggle command to be registered')

    await waggleCommand.handler('code-review Review this migration', harness.ctx)

    expect(harness.appendedEntries).toEqual([])
    expect(harness.sendMessage).not.toHaveBeenCalled()
    expect(harness.setModel).not.toHaveBeenCalled()
  })

  it('writes an explicit disabled mode-state entry for /standard', async () => {
    const harness = createPackageLoadHarness()
    defaultPiWaggleExtension(harness.pi)
    const standardCommand = harness.commands.get('standard')
    if (!standardCommand) throw new Error('Expected /standard command to be registered')

    await standardCommand.handler('', harness.ctx)

    expect(harness.appendedEntries).toEqual([
      {
        customType: 'pi-waggle.mode-state',
        data: expect.objectContaining({ enabled: false }),
      },
    ])
  })
})
