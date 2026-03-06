import { SupportedModelId, TeamConfigId } from '@shared/types/brand'
import type { ProviderInfo } from '@shared/types/llm'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import type { WaggleTeamPreset } from '@shared/types/waggle'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listTeamsMock, saveTeamMock, deleteTeamMock, usePreferencesMock, useProvidersMock } =
  vi.hoisted(() => ({
    listTeamsMock: vi.fn(),
    saveTeamMock: vi.fn(),
    deleteTeamMock: vi.fn(),
    usePreferencesMock: vi.fn(),
    useProvidersMock: vi.fn(),
  }))

vi.mock('@/hooks/useSettings', () => ({
  usePreferences: usePreferencesMock,
  useProviders: useProvidersMock,
}))

vi.mock('@/lib/ipc', () => ({
  api: {
    listTeams: listTeamsMock,
    saveTeam: saveTeamMock,
    deleteTeam: deleteTeamMock,
  },
}))

vi.mock('../../shared/ModelSelector', () => ({
  ModelSelector: ({
    value,
    onChange,
    providerModels,
  }: {
    value: string
    onChange: (model: string) => void
    providerModels: ProviderInfo[]
  }) => (
    <select aria-label="Model" value={value} onChange={(event) => onChange(event.target.value)}>
      {providerModels.flatMap((group) =>
        group.models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.name}
          </option>
        )),
      )}
    </select>
  ),
}))

import { WaggleSection } from '../sections/WaggleSection'

const PROVIDER_MODELS: ProviderInfo[] = [
  {
    provider: 'anthropic',
    displayName: 'Anthropic',
    requiresApiKey: true,
    supportsBaseUrl: false,
    supportsSubscription: false,
    supportsDynamicModelFetch: false,
    models: [
      {
        id: SupportedModelId('claude-sonnet-4-5'),
        name: 'Claude Sonnet 4.5',
        provider: 'anthropic',
      },
      {
        id: SupportedModelId('claude-opus-4'),
        name: 'Claude Opus 4',
        provider: 'anthropic',
      },
    ],
  },
]

function createPreset(overrides?: Partial<WaggleTeamPreset>): WaggleTeamPreset {
  return {
    id: TeamConfigId('team-1'),
    name: 'Review Pair',
    description: 'Custom: Finds regressions before they land.',
    config: {
      mode: 'sequential',
      agents: [
        {
          label: 'Reviewer',
          model: SupportedModelId('claude-sonnet-4-5'),
          roleDescription: 'Finds regressions before they land.',
          color: 'blue',
        },
        {
          label: 'Implementer',
          model: SupportedModelId('claude-opus-4'),
          roleDescription: 'Shapes the implementation details.',
          color: 'amber',
        },
      ],
      stop: {
        primary: 'consensus',
        maxTurnsSafety: 8,
      },
    },
    isBuiltIn: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('WaggleSection', () => {
  beforeEach(() => {
    listTeamsMock.mockReset()
    saveTeamMock.mockReset()
    deleteTeamMock.mockReset()
    usePreferencesMock.mockReset()
    useProvidersMock.mockReset()

    usePreferencesMock.mockReturnValue({
      settings: DEFAULT_SETTINGS,
    })
    useProvidersMock.mockReturnValue({
      providerModels: PROVIDER_MODELS,
    })
    deleteTeamMock.mockResolvedValue(undefined)
  })

  it('loads a selected preset into the editable form', async () => {
    const preset = createPreset()
    listTeamsMock.mockResolvedValueOnce([preset])

    render(<WaggleSection />)

    fireEvent.click((await screen.findByText('Review Pair')).closest('button') ?? document.body)

    await waitFor(() => {
      expect(screen.getByDisplayValue('Reviewer')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Implementer')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Finds regressions before they land.')).toBeInTheDocument()
    })
  })

  it('saves edits back to the active preset using the current form state', async () => {
    const preset = createPreset()
    const savedPreset = createPreset({
      name: 'Refiner + Implementer',
      description: 'Custom: Tightens the remediation plan.',
      config: {
        ...preset.config,
        agents: [
          {
            ...preset.config.agents[0],
            label: 'Refiner',
            roleDescription: 'Tightens the remediation plan.',
          },
          preset.config.agents[1],
        ],
      },
      updatedAt: 2,
    })
    listTeamsMock.mockResolvedValueOnce([preset]).mockResolvedValueOnce([savedPreset])
    saveTeamMock.mockResolvedValueOnce(savedPreset)

    render(<WaggleSection />)

    fireEvent.click((await screen.findByText('Review Pair')).closest('button') ?? document.body)
    fireEvent.change(screen.getByDisplayValue('Reviewer'), {
      target: { value: 'Refiner' },
    })
    fireEvent.change(screen.getByDisplayValue('Finds regressions before they land.'), {
      target: { value: 'Tightens the remediation plan.' },
    })

    fireEvent.click(await screen.findByRole('button', { name: /save changes/i }))

    await waitFor(() => {
      expect(saveTeamMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: preset.id,
          name: 'Refiner + Implementer',
          description: 'Custom: Tightens the remediation plan.',
          config: expect.objectContaining({
            agents: expect.arrayContaining([
              expect.objectContaining({
                label: 'Refiner',
                roleDescription: 'Tightens the remediation plan.',
              }),
            ]),
          }),
        }),
      )
    })
    expect(listTeamsMock).toHaveBeenCalledTimes(2)
  })

  it('creates a new custom preset from the current form values', async () => {
    const savedPreset = createPreset({
      id: TeamConfigId('team-2'),
      name: 'Strategist + Skeptic',
      description: 'Custom: Frames trade-offs before implementation.',
      config: {
        mode: 'sequential',
        agents: [
          {
            label: 'Strategist',
            model: SupportedModelId('claude-sonnet-4-5'),
            roleDescription: 'Frames trade-offs before implementation.',
            color: 'blue',
          },
          {
            label: 'Skeptic',
            model: SupportedModelId('claude-opus-4'),
            roleDescription: 'Challenges weak assumptions.',
            color: 'amber',
          },
        ],
        stop: {
          primary: 'consensus',
          maxTurnsSafety: 8,
        },
      },
    })
    listTeamsMock.mockResolvedValueOnce([]).mockResolvedValueOnce([savedPreset])
    saveTeamMock.mockResolvedValueOnce(savedPreset)

    render(<WaggleSection />)

    fireEvent.change(screen.getByDisplayValue('Agent A'), {
      target: { value: 'Strategist' },
    })
    fireEvent.change(screen.getByDisplayValue('Agent B'), {
      target: { value: 'Skeptic' },
    })
    fireEvent.change(screen.getAllByPlaceholderText(/describe this agent's role/i)[0], {
      target: { value: 'Frames trade-offs before implementation.' },
    })

    fireEvent.click(screen.getByRole('button', { name: /new custom preset/i }))

    await waitFor(() => {
      expect(saveTeamMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: TeamConfigId(''),
          name: 'Strategist + Skeptic',
          description: 'Custom: Frames trade-offs before implementation.',
          isBuiltIn: false,
        }),
      )
    })
    expect(listTeamsMock).toHaveBeenCalledTimes(2)
  })

  it('shows an inline error when presets fail to load', async () => {
    listTeamsMock.mockRejectedValueOnce(new Error('Failed to load presets'))

    render(<WaggleSection />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load presets')
  })

  it('shows an inline error when saving edits fails', async () => {
    const preset = createPreset()
    listTeamsMock.mockResolvedValueOnce([preset])
    saveTeamMock.mockRejectedValueOnce(new Error('Save exploded'))

    render(<WaggleSection />)

    fireEvent.click((await screen.findByText('Review Pair')).closest('button') ?? document.body)
    fireEvent.change(screen.getByDisplayValue('Reviewer'), {
      target: { value: 'Refiner' },
    })

    fireEvent.click(await screen.findByRole('button', { name: /save changes/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Save exploded')
  })
})
