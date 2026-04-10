import { SupportedModelId } from '@shared/types/brand'
import type { McpServerConfig } from '@shared/types/mcp'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getSettingsMock,
  updateSettingsMock,
  transformMcpServersMock,
  initializeSettingsStoreMock,
  flushSettingsStoreMock,
} = vi.hoisted(() => ({
  getSettingsMock: vi.fn(),
  updateSettingsMock: vi.fn(),
  transformMcpServersMock: vi.fn(),
  initializeSettingsStoreMock: vi.fn(),
  flushSettingsStoreMock: vi.fn(),
}))

vi.mock('../../store/settings', () => ({
  getSettings: getSettingsMock,
  updateSettings: updateSettingsMock,
  transformMcpServers: transformMcpServersMock,
  initializeSettingsStore: initializeSettingsStoreMock,
  flushSettingsStoreForTests: flushSettingsStoreMock,
}))

import { SettingsService } from '../settings-service'

describe('SettingsService.Live', () => {
  beforeEach(() => {
    getSettingsMock.mockReset()
    updateSettingsMock.mockReset()
    transformMcpServersMock.mockReset()
    initializeSettingsStoreMock.mockReset()
    flushSettingsStoreMock.mockReset()
  })

  it('delegates get to getSettings()', async () => {
    const settings = { defaultModel: 'claude-sonnet-4-5', providers: {} }
    getSettingsMock.mockReturnValue(settings)

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* SettingsService
        return yield* service.get()
      }).pipe(Effect.provide(SettingsService.Live)),
    )

    expect(result).toBe(settings)
    expect(getSettingsMock).toHaveBeenCalledOnce()
  })

  it('delegates update to updateSettings()', async () => {
    const partial = { defaultModel: SupportedModelId('gpt-4o') }

    await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* SettingsService
        yield* service.update(partial)
      }).pipe(Effect.provide(SettingsService.Live)),
    )

    expect(updateSettingsMock).toHaveBeenCalledWith(partial)
  })

  it('delegates initialize to initializeSettingsStore()', async () => {
    initializeSettingsStoreMock.mockResolvedValue(undefined)

    await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* SettingsService
        yield* service.initialize()
      }).pipe(Effect.provide(SettingsService.Live)),
    )

    expect(initializeSettingsStoreMock).toHaveBeenCalledOnce()
  })

  it('delegates flushForTests to flushSettingsStoreForTests()', async () => {
    flushSettingsStoreMock.mockResolvedValue(undefined)

    await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* SettingsService
        yield* service.flushForTests()
      }).pipe(Effect.provide(SettingsService.Live)),
    )

    expect(flushSettingsStoreMock).toHaveBeenCalledOnce()
  })

  it('delegates transformMcpServers to transformMcpServers()', async () => {
    const transformer = (servers: readonly McpServerConfig[]) => [...servers]

    await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* SettingsService
        yield* service.transformMcpServers(transformer)
      }).pipe(Effect.provide(SettingsService.Live)),
    )

    expect(transformMcpServersMock).toHaveBeenCalledWith(transformer)
  })
})
