import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { type Mock, vi } from 'vitest'
import { ProviderProbeService } from '../../ports/provider-probe-service'
import { ProviderService } from '../../ports/provider-service'
import { SessionTreePreferencesService } from '../../ports/session-tree-preferences-service'
import { SettingsService } from '../../services/settings-service'
import type * as SettingsHandler from '../settings-handler'

type TestMock = Mock

interface SettingsHandlerMocks {
  readonly typedHandleMock: TestMock
  readonly getSettingsMock: TestMock
  readonly updateSettingsMock: TestMock
  readonly providerServiceGetMock: TestMock
  readonly probeCredentialsMock: TestMock
  readonly getTreeFilterModeMock: TestMock
  readonly setTreeFilterModeMock: TestMock
  readonly getBranchSummarySkipPromptMock: TestMock
}

const mocks: SettingsHandlerMocks = vi.hoisted(() => ({
  typedHandleMock: vi.fn(),
  getSettingsMock: vi.fn(),
  updateSettingsMock: vi.fn(),
  providerServiceGetMock: vi.fn(),
  probeCredentialsMock: vi.fn(),
  getTreeFilterModeMock: vi.fn(),
  setTreeFilterModeMock: vi.fn(),
  getBranchSummarySkipPromptMock: vi.fn(),
}))

export const typedHandleMock: TestMock = mocks.typedHandleMock
export const getSettingsMock: TestMock = mocks.getSettingsMock
export const updateSettingsMock: TestMock = mocks.updateSettingsMock
export const providerServiceGetMock: TestMock = mocks.providerServiceGetMock
export const probeCredentialsMock: TestMock = mocks.probeCredentialsMock
export const getTreeFilterModeMock: TestMock = mocks.getTreeFilterModeMock
export const setTreeFilterModeMock: TestMock = mocks.setTreeFilterModeMock
export const getBranchSummarySkipPromptMock: TestMock = mocks.getBranchSummarySkipPromptMock

vi.mock('../typed-ipc', () => ({
  typedHandle: typedHandleMock,
}))

vi.mock('../../store/settings', () => ({
  getSettings: getSettingsMock,
  updateSettings: updateSettingsMock,
}))

vi.mock('../../logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

const TestSettingsLayer = Layer.succeed(SettingsService, {
  get: () => Effect.sync(() => getSettingsMock()),
  update: (partial) => Effect.sync(() => updateSettingsMock(partial)),
  initialize: () => Effect.void,
  flushForTests: () => Effect.void,
})

const TestProviderServiceLayer = Layer.succeed(ProviderService, {
  get: (providerId) => Effect.sync(() => providerServiceGetMock(providerId)),
  getAll: () => Effect.succeed([]),
  getProviderForModel: () => Effect.dieMessage('not used by settings handler tests'),
  isKnownModel: () => Effect.succeed(true),
})

const TestSessionTreePreferencesLayer = Layer.succeed(SessionTreePreferencesService, {
  getTreeFilterMode: (projectPath) => Effect.sync(() => getTreeFilterModeMock(projectPath)),
  setTreeFilterMode: (mode, projectPath) =>
    Effect.sync(() => setTreeFilterModeMock(mode, projectPath)),
  getBranchSummarySkipPrompt: (projectPath) =>
    Effect.sync(() => getBranchSummarySkipPromptMock(projectPath)),
})

const TestProviderProbeLayer = Layer.succeed(ProviderProbeService, {
  probeCredentials: (input) =>
    Effect.tryPromise({
      try: () => Promise.resolve(probeCredentialsMock(input)),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    }),
})

const TestLayer = Layer.mergeAll(
  TestSettingsLayer,
  TestProviderServiceLayer,
  TestProviderProbeLayer,
  TestSessionTreePreferencesLayer,
)

export function getTypedEffectInvokeHandler(name: string) {
  const call = typedHandleMock.mock.calls.find(
    (candidate: readonly unknown[]) => candidate[0] === name && typeof candidate[1] === 'function',
  )
  const handler = call?.[1]
  if (typeof handler !== 'function') {
    return undefined
  }

  return (...args: unknown[]) => Effect.runPromise(Effect.provide(handler(...args), TestLayer))
}

export function resetSettingsHandlerMocks() {
  typedHandleMock.mockReset()
  getSettingsMock.mockReset()
  updateSettingsMock.mockReset()
  providerServiceGetMock.mockReset()
  probeCredentialsMock.mockReset()
  getTreeFilterModeMock.mockReset()
  setTreeFilterModeMock.mockReset()
  getBranchSummarySkipPromptMock.mockReset()
}

export function loadSettingsHandlers(): Promise<typeof SettingsHandler> {
  return import('../settings-handler')
}
