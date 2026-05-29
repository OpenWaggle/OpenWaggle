import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import type { ExtensionAPI, ExtensionCommandContext } from '@mariozechner/pi-coding-agent'
import { WAGGLE_INHERIT_MODEL } from '@openwaggle/waggle-core'
import { fromAny, fromPartial } from '@total-typescript/shoehorn'
import { vi } from 'vitest'
import type { WaggleMenuAction } from '../default-control-center-view'
import type { PiWaggleModel } from '../extension'
import defaultPiWaggleExtension from '../extension'

const TEST_HOME_PREFIX = '/tmp/pi-waggle-'
const fallbackUserHomeDir = `/tmp/pi-waggle-commands-home-${randomUUID()}`
const testUserHomeDir = homedir().startsWith(TEST_HOME_PREFIX) ? homedir() : fallbackUserHomeDir

export const userHomeDir = testUserHomeDir
export const projectDir = `${testUserHomeDir}-project`
export const PROJECT_SCOPE_LABEL = 'Project (.pi/waggle-presets.json)'
export const PRIMARY_MODEL = 'openai/gpt-5.5'

const FIRST_PROVIDER_CHARACTER_INDEX = 0
const MODEL_ID_START_OFFSET = 1
const MAX_TURNS_SAFETY = 4
const JSON_INDENT_SPACES = 2
const CREATED_AT = 1
const UPDATED_AT = 2
const RESET_RETRY_COUNT = 3
const RESET_RETRY_DELAY_MS = 10

type RegisteredCommandOptions = Parameters<ExtensionAPI['registerCommand']>[1]
type SelectResponse = string | undefined

type BranchEntry = {
  readonly id: string
  readonly parentId: string | null
  readonly timestamp: string
  readonly type: 'custom'
  readonly customType: string
  readonly data: unknown
}

export function customPreset(id: string, name: string) {
  return {
    id,
    name,
    description: `${name} description`,
    config: {
      mode: 'sequential',
      agents: [
        {
          label: 'Custom A',
          model: WAGGLE_INHERIT_MODEL,
          roleDescription: 'First custom agent',
          color: 'blue',
        },
        {
          label: 'Custom B',
          model: WAGGLE_INHERIT_MODEL,
          roleDescription: 'Second custom agent',
          color: 'amber',
        },
      ],
      stop: { primary: 'consensus', maxTurnsSafety: MAX_TURNS_SAFETY },
    },
    isBuiltIn: false,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
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

export function configEditorJson(maxTurnsSafety: number) {
  return JSON.stringify(
    {
      mode: 'sequential',
      agents: [
        {
          label: 'Architect',
          model: PRIMARY_MODEL,
          roleDescription: 'Plans the implementation',
          color: 'blue',
        },
        {
          label: 'Reviewer',
          model: PRIMARY_MODEL,
          roleDescription: 'Reviews the implementation',
          color: 'amber',
        },
      ],
      stop: {
        primary: 'consensus',
        maxTurnsSafety,
      },
    },
    null,
    JSON_INDENT_SPACES,
  )
}

export function activeModeStateEntry(configJson: string): BranchEntry {
  return {
    id: 'mode-state',
    parentId: null,
    timestamp: '2026-05-25T00:00:00.000Z',
    type: 'custom',
    customType: 'pi-waggle.mode-state',
    data: {
      enabled: true,
      presetId: 'code-review',
      config: JSON.parse(configJson),
      updatedAt: CREATED_AT,
    },
  }
}

async function removeTestDirectory(path: string) {
  for (let attempt = 0; attempt < RESET_RETRY_COUNT; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true })
      return
    } catch (error) {
      if (attempt === RESET_RETRY_COUNT - 1) throw error
      await new Promise((resolve) => setTimeout(resolve, RESET_RETRY_DELAY_MS))
    }
  }
}

export async function resetPiWaggleCommandTestFiles() {
  vi.stubEnv('HOME', userHomeDir)
  await Promise.all([removeTestDirectory(userHomeDir), removeTestDirectory(projectDir)])
}

export function createHarness(
  input: {
    readonly selectResponses?: readonly SelectResponse[]
    readonly customResponses?: readonly (WaggleMenuAction | undefined)[]
    readonly editorResponses?: readonly (string | undefined)[]
    readonly inputResponses?: readonly (string | undefined)[]
    readonly branchEntries?: readonly BranchEntry[]
    readonly hasUI?: boolean
  } = {},
) {
  vi.stubEnv('HOME', userHomeDir)
  const commands = new Map<string, RegisteredCommandOptions>()
  const appendedEntries: Array<{ readonly customType: string; readonly data: unknown }> = []
  const selectQueue = [...(input.selectResponses ?? [])]
  const customQueue = [...(input.customResponses ?? [])]
  const editorQueue = [...(input.editorResponses ?? [])]
  const inputQueue = [...(input.inputResponses ?? [])]
  const sendMessage = vi.fn<ExtensionAPI['sendMessage']>()
  const setModel = vi.fn<ExtensionAPI['setModel']>(async () => true)
  function custom<T>() {
    return Promise.resolve(fromAny<T, WaggleMenuAction | undefined>(customQueue.shift()))
  }

  const pi = fromPartial<ExtensionAPI>({
    appendEntry: vi.fn((customType: string, data?: unknown) => {
      appendedEntries.push({ customType, data })
    }),
    getFlag: vi.fn(),
    on: vi.fn(),
    registerCommand: vi.fn((name: string, options: RegisteredCommandOptions) => {
      commands.set(name, options)
    }),
    registerMessageRenderer: vi.fn(),
    sendMessage,
    setModel,
  })
  const currentModel = modelFor(PRIMARY_MODEL)
  const ctx = fromPartial<ExtensionCommandContext>({
    cwd: projectDir,
    hasUI: input.hasUI ?? true,
    isIdle: () => true,
    model: currentModel,
    modelRegistry: {
      find: (provider: string, modelId: string) =>
        provider === currentModel.provider && modelId === currentModel.id
          ? currentModel
          : undefined,
    },
    sessionManager: {
      getBranch: () => [...(input.branchEntries ?? [])],
    },
    ui: {
      notify: vi.fn(),
      select: vi.fn(async () => selectQueue.shift()),
      ...(input.customResponses ? { custom: vi.fn(custom) } : {}),
      confirm: vi.fn(async () => true),
      editor: vi.fn(async () => editorQueue.shift()),
      input: vi.fn(async () => inputQueue.shift()),
      setStatus: vi.fn(),
      setWorkingMessage: vi.fn(),
    },
    waitForIdle: vi.fn(async () => undefined),
  })

  defaultPiWaggleExtension(pi)
  const waggleCommand = commands.get('waggle')
  const standardCommand = commands.get('standard')
  if (!waggleCommand || !standardCommand) {
    throw new Error('Expected Waggle commands to be registered')
  }

  return {
    appendedEntries,
    ctx,
    sendMessage,
    setModelCallCount: () => setModel.mock.calls.length,
    standardCommand,
    waggleCommand,
  }
}
