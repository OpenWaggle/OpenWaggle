import { SupportedModelId, WagglePresetId } from '@shared/types/brand'
import type { ProviderInfo } from '@shared/types/llm'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import type { WagglePreset } from '@shared/types/waggle'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePreferencesStore } from '../../../stores/preferences-store'
import { useUIStore } from '../../../stores/ui-store'
import { useWaggleStore } from '../../../stores/waggle-store'
import { renderWithQueryClient } from '../../../test-utils/query-test-utils'
import { CommandPalette } from '../../command-palette/CommandPalette'

const {
  listWagglePresetsMock,
  saveWagglePresetMock,
  deleteWagglePresetMock,
  usePreferencesMock,
  useProvidersMock,
} = vi.hoisted(() => ({
  listWagglePresetsMock: vi.fn(),
  saveWagglePresetMock: vi.fn(),
  deleteWagglePresetMock: vi.fn(),
  usePreferencesMock: vi.fn(),
  useProvidersMock: vi.fn(),
}))

vi.mock('@/hooks/useSettings', () => ({
  usePreferences: usePreferencesMock,
  useProviders: useProvidersMock,
}))

vi.mock('@/lib/ipc', () => ({
  api: {
    listWagglePresets: listWagglePresetsMock,
    saveWagglePreset: saveWagglePresetMock,
    deleteWagglePreset: deleteWagglePresetMock,
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

    auth: {
      configured: true,
      source: 'api-key',
      apiKeyConfigured: true,
      apiKeySource: 'api-key',
      oauthConnected: false,
      supportsApiKey: true,
      supportsOAuth: true,
    },
    models: [
      {
        id: SupportedModelId('anthropic/claude-sonnet-4-5'),
        modelId: 'claude-sonnet-4-5',
        name: 'Claude Sonnet 4.5',
        provider: 'anthropic',
        available: true,
        availableThinkingLevels: ['off', 'minimal', 'low', 'medium', 'high'],
      },
      {
        id: SupportedModelId('anthropic/claude-opus-4'),
        modelId: 'claude-opus-4',
        name: 'Claude Opus 4',
        provider: 'anthropic',
        available: true,
        availableThinkingLevels: ['off', 'minimal', 'low', 'medium', 'high'],
      },
    ],
  },
]

const PROJECT_PATH = '/tmp/openwaggle-project'

function createPreset(overrides?: Partial<WagglePreset>): WagglePreset {
  return {
    id: WagglePresetId('preset-1'),
    name: 'Review Pair',
    description: 'Custom: Finds regressions before they land.',
    config: {
      mode: 'sequential',
      agents: [
        {
          label: 'Reviewer',
          model: SupportedModelId('anthropic/claude-sonnet-4-5'),
          roleDescription: 'Finds regressions before they land.',
          color: 'blue',
        },
        {
          label: 'Implementer',
          model: SupportedModelId('anthropic/claude-opus-4'),
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
    listWagglePresetsMock.mockReset()
    saveWagglePresetMock.mockReset()
    deleteWagglePresetMock.mockReset()
    usePreferencesMock.mockReset()
    useProvidersMock.mockReset()
    usePreferencesStore.setState({
      ...usePreferencesStore.getInitialState(),
      settings: {
        ...DEFAULT_SETTINGS,
        projectPath: PROJECT_PATH,
      },
    })
    useUIStore.setState(useUIStore.getInitialState())
    useWaggleStore.setState(useWaggleStore.getInitialState())

    usePreferencesMock.mockReturnValue({
      settings: DEFAULT_SETTINGS,
    })
    useProvidersMock.mockReturnValue({
      providerModels: PROVIDER_MODELS,
    })
    deleteWagglePresetMock.mockResolvedValue(undefined)
  })

  it('loads a selected preset into the editable form', async () => {
    const preset = createPreset()
    listWagglePresetsMock.mockResolvedValueOnce([preset])

    renderWithQueryClient(<WaggleSection />)

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
    listWagglePresetsMock.mockResolvedValueOnce([preset]).mockResolvedValueOnce([savedPreset])
    saveWagglePresetMock.mockResolvedValueOnce(savedPreset)

    renderWithQueryClient(<WaggleSection />)

    fireEvent.click((await screen.findByText('Review Pair')).closest('button') ?? document.body)
    fireEvent.change(screen.getByDisplayValue('Reviewer'), {
      target: { value: 'Refiner' },
    })
    fireEvent.change(screen.getByDisplayValue('Finds regressions before they land.'), {
      target: { value: 'Tightens the remediation plan.' },
    })

    fireEvent.click(await screen.findByRole('button', { name: /save changes/i }))

    await waitFor(() => {
      expect(saveWagglePresetMock).toHaveBeenCalledWith(
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
        PROJECT_PATH,
      )
    })
    expect(listWagglePresetsMock).toHaveBeenCalledTimes(2)
  })

  it('creates a new custom preset from the current form values', async () => {
    const savedPreset = createPreset({
      id: WagglePresetId('preset-2'),
      name: 'Strategist + Skeptic',
      description: 'Custom: Frames trade-offs before implementation.',
      config: {
        mode: 'sequential',
        agents: [
          {
            label: 'Strategist',
            model: SupportedModelId('anthropic/claude-sonnet-4-5'),
            roleDescription: 'Frames trade-offs before implementation.',
            color: 'blue',
          },
          {
            label: 'Skeptic',
            model: SupportedModelId('anthropic/claude-opus-4'),
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
    listWagglePresetsMock.mockResolvedValueOnce([]).mockResolvedValueOnce([savedPreset])
    saveWagglePresetMock.mockResolvedValueOnce(savedPreset)

    renderWithQueryClient(<WaggleSection />)

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
      expect(saveWagglePresetMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: WagglePresetId(''),
          name: 'Strategist + Skeptic',
          description: 'Custom: Frames trade-offs before implementation.',
          isBuiltIn: false,
        }),
        PROJECT_PATH,
      )
    })
    expect(listWagglePresetsMock).toHaveBeenCalledTimes(2)
  })

  it('shows an inline error when presets fail to load', async () => {
    listWagglePresetsMock.mockRejectedValueOnce(new Error('Failed to load presets'))

    renderWithQueryClient(<WaggleSection />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load presets')
  })

  it('shows an inline error when saving edits fails', async () => {
    const preset = createPreset()
    listWagglePresetsMock.mockResolvedValueOnce([preset])
    saveWagglePresetMock.mockRejectedValueOnce(new Error('Save exploded'))

    renderWithQueryClient(<WaggleSection />)

    fireEvent.click((await screen.findByText('Review Pair')).closest('button') ?? document.body)
    fireEvent.change(screen.getByDisplayValue('Reviewer'), {
      target: { value: 'Refiner' },
    })

    fireEvent.click(await screen.findByRole('button', { name: /save changes/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Save exploded')
  })

  it('shares the Waggle preset query cache with the command palette', async () => {
    const preset = createPreset()
    listWagglePresetsMock.mockResolvedValueOnce([preset])

    renderWithQueryClient(
      <>
        <WaggleSection />
        <CommandPalette slashSkills={[]} onSelectSkill={vi.fn()} onStartWaggle={vi.fn()} />
      </>,
    )

    await waitFor(() => {
      expect(listWagglePresetsMock).toHaveBeenCalledTimes(1)
      expect(listWagglePresetsMock).toHaveBeenCalledWith(PROJECT_PATH)
    })

    fireEvent.change(screen.getByPlaceholderText('Search'), { target: { value: 'review' } })

    await waitFor(() => {
      const presetButtons = screen.getAllByRole('button', { name: /review pair/i })
      expect(presetButtons.length).toBeGreaterThan(0)
    })

    const paletteButton = screen
      .getAllByRole('button', { name: /review pair/i })
      .find((button) => within(button).queryByText('Sequential'))

    expect(paletteButton).toBeTruthy()
  })
})
