import { SupportedModelId, WagglePresetId } from '@shared/types/brand'
import type { WagglePreset } from '@shared/types/waggle'
import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WagglePresetsRepository } from '../../ports/waggle-presets-repository'

const { typedHandleMock, listWagglePresetsMock, saveWagglePresetMock, deleteWagglePresetMock } =
  vi.hoisted(() => ({
    typedHandleMock: vi.fn(),
    listWagglePresetsMock: vi.fn(),
    saveWagglePresetMock: vi.fn(),
    deleteWagglePresetMock: vi.fn(),
  }))

vi.mock('../typed-ipc', () => ({
  typedHandle: typedHandleMock,
}))

import { registerWagglePresetsHandlers } from '../waggle-presets-handler'

function getInvokeHandler(name: string): ((...args: unknown[]) => Promise<unknown>) | undefined {
  const call = typedHandleMock.mock.calls.find(
    (args: readonly unknown[]) => args[0] === name && typeof args[1] === 'function',
  )
  const handler = call?.[1]
  if (typeof handler !== 'function') {
    return undefined
  }

  const TestWagglePresetsLayer = Layer.succeed(WagglePresetsRepository, {
    list: (projectPath) => Effect.sync(() => listWagglePresetsMock(projectPath)),
    save: (preset, projectPath) => Effect.sync(() => saveWagglePresetMock(preset, projectPath)),
    delete: (id, projectPath) => Effect.sync(() => deleteWagglePresetMock(id, projectPath)),
  })

  return (...args: unknown[]) =>
    Effect.runPromise(Effect.provide(handler(...args), TestWagglePresetsLayer))
}

function samplePreset(): WagglePreset {
  return {
    id: WagglePresetId('preset-1'),
    name: 'Code Review',
    description: 'Two-agent code review',
    config: {
      mode: 'sequential',
      agents: [
        {
          label: 'Architect',
          model: SupportedModelId('claude-sonnet-4-5'),
          roleDescription: 'Senior architect',
          color: 'blue',
        },
        {
          label: 'Reviewer',
          model: SupportedModelId('claude-sonnet-4-5'),
          roleDescription: 'Code reviewer',
          color: 'amber',
        },
      ],
      stop: { primary: 'consensus', maxTurnsSafety: 8 },
    },
    isBuiltIn: false,
    createdAt: 1000,
    updatedAt: 1000,
  }
}

describe('registerWagglePresetsHandlers', () => {
  beforeEach(() => {
    typedHandleMock.mockReset()
    listWagglePresetsMock.mockReset()
    saveWagglePresetMock.mockReset()
    deleteWagglePresetMock.mockReset()
  })

  it('registers all expected IPC channels', () => {
    registerWagglePresetsHandlers()

    const channels = typedHandleMock.mock.calls.map((args: unknown[]) => args[0])
    expect(channels).toContain('waggle-presets:list')
    expect(channels).toContain('waggle-presets:save')
    expect(channels).toContain('waggle-presets:delete')
  })

  describe('waggle-presets:list', () => {
    it('returns the list of Waggle presets', async () => {
      const presets = [samplePreset()]
      listWagglePresetsMock.mockReturnValue(presets)

      registerWagglePresetsHandlers()
      const handler = getInvokeHandler('waggle-presets:list')

      const result = await handler?.({}, '/tmp/project')
      expect(result).toEqual(presets)
      expect(listWagglePresetsMock).toHaveBeenCalledWith('/tmp/project')
    })

    it('returns an empty array when no presets exist', async () => {
      listWagglePresetsMock.mockReturnValue([])

      registerWagglePresetsHandlers()
      const handler = getInvokeHandler('waggle-presets:list')

      const result = await handler?.({}, null)
      expect(result).toEqual([])
    })
  })

  describe('waggle-presets:save', () => {
    it('saves a Waggle preset and returns the saved result', async () => {
      const preset = samplePreset()
      const savedPreset = { ...preset, updatedAt: 2000 }
      saveWagglePresetMock.mockReturnValue(savedPreset)

      registerWagglePresetsHandlers()
      const handler = getInvokeHandler('waggle-presets:save')

      const result = await handler?.({}, preset, '/tmp/project')
      expect(result).toEqual(savedPreset)
      expect(saveWagglePresetMock).toHaveBeenCalledWith(preset, '/tmp/project')
    })
  })

  describe('waggle-presets:delete', () => {
    it('deletes a Waggle preset by ID', async () => {
      registerWagglePresetsHandlers()
      const handler = getInvokeHandler('waggle-presets:delete')

      await handler?.({}, WagglePresetId('preset-1'), '/tmp/project')
      expect(deleteWagglePresetMock).toHaveBeenCalledWith(
        WagglePresetId('preset-1'),
        '/tmp/project',
      )
    })
  })
})
