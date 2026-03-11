import { SupportedModelId, TeamConfigId } from '@shared/types/brand'
import type { WaggleTeamPreset } from '@shared/types/waggle'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { typedHandleMock, listTeamPresetsMock, saveTeamPresetMock, deleteTeamPresetMock } =
  vi.hoisted(() => ({
    typedHandleMock: vi.fn(),
    listTeamPresetsMock: vi.fn(),
    saveTeamPresetMock: vi.fn(),
    deleteTeamPresetMock: vi.fn(),
  }))

vi.mock('../typed-ipc', () => ({
  typedHandle: typedHandleMock,
}))

vi.mock('../../store/teams', () => ({
  listTeamPresets: listTeamPresetsMock,
  saveTeamPreset: saveTeamPresetMock,
  deleteTeamPreset: deleteTeamPresetMock,
}))

import { registerTeamsHandlers } from '../teams-handler'

function getInvokeHandler(name: string): ((...args: unknown[]) => Promise<unknown>) | undefined {
  const call = typedHandleMock.mock.calls.find(
    (args: readonly unknown[]) => args[0] === name && typeof args[1] === 'function',
  )
  const handler = call?.[1]
  if (typeof handler !== 'function') {
    return undefined
  }

  return (...args: unknown[]) => Effect.runPromise(handler(...args))
}

function samplePreset(): WaggleTeamPreset {
  return {
    id: TeamConfigId('preset-1'),
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

describe('registerTeamsHandlers', () => {
  beforeEach(() => {
    typedHandleMock.mockReset()
    listTeamPresetsMock.mockReset()
    saveTeamPresetMock.mockReset()
    deleteTeamPresetMock.mockReset()
  })

  it('registers all expected IPC channels', () => {
    registerTeamsHandlers()

    const channels = typedHandleMock.mock.calls.map((args: unknown[]) => args[0])
    expect(channels).toContain('teams:list')
    expect(channels).toContain('teams:save')
    expect(channels).toContain('teams:delete')
  })

  describe('teams:list', () => {
    it('returns the list of team presets', async () => {
      const presets = [samplePreset()]
      listTeamPresetsMock.mockReturnValue(presets)

      registerTeamsHandlers()
      const handler = getInvokeHandler('teams:list')

      const result = await handler?.()
      expect(result).toEqual(presets)
      expect(listTeamPresetsMock).toHaveBeenCalledOnce()
    })

    it('returns an empty array when no presets exist', async () => {
      listTeamPresetsMock.mockReturnValue([])

      registerTeamsHandlers()
      const handler = getInvokeHandler('teams:list')

      const result = await handler?.()
      expect(result).toEqual([])
    })
  })

  describe('teams:save', () => {
    it('saves a team preset and returns the saved result', async () => {
      const preset = samplePreset()
      const savedPreset = { ...preset, updatedAt: 2000 }
      saveTeamPresetMock.mockReturnValue(savedPreset)

      registerTeamsHandlers()
      const handler = getInvokeHandler('teams:save')

      const result = await handler?.({}, preset)
      expect(result).toEqual(savedPreset)
      expect(saveTeamPresetMock).toHaveBeenCalledWith(preset)
    })
  })

  describe('teams:delete', () => {
    it('deletes a team preset by ID', async () => {
      registerTeamsHandlers()
      const handler = getInvokeHandler('teams:delete')

      await handler?.({}, TeamConfigId('preset-1'))
      expect(deleteTeamPresetMock).toHaveBeenCalledWith(TeamConfigId('preset-1'))
    })
  })
})
