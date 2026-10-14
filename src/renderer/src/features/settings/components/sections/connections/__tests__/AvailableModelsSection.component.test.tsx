import { SupportedModelId } from '@shared/types/brand'
import type { ProviderInfo } from '@shared/types/llm'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { useProviderStore } from '@/features/providers/state'
import { usePreferencesStore } from '@/features/settings/state'
import { AvailableModelsSection } from '../AvailableModelsSection'

const { setEnabledModelsMock, updateSettingsMock } = vi.hoisted(() => ({
  setEnabledModelsMock: vi.fn(),
  updateSettingsMock: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    setEnabledModels: setEnabledModelsMock,
    updateSettings: updateSettingsMock,
  },
}))

const SONNET = SupportedModelId('anthropic/claude-sonnet')
const HAIKU = SupportedModelId('anthropic/claude-haiku')
const GPT = SupportedModelId('openrouter/openai/gpt-5')
const CODER = SupportedModelId('openrouter/qwen/qwen3-coder')

function provider(
  name: ProviderInfo['provider'],
  displayName: string,
  configured: boolean,
  models: readonly { readonly id: SupportedModelId; readonly name: string }[],
) {
  return {
    provider: name,
    displayName,
    auth: {
      configured,
      source: configured ? 'api-key' : 'none',
      apiKeyConfigured: configured,
      apiKeySource: configured ? 'api-key' : 'none',
      oauthConnected: false,
      supportsApiKey: true,
      supportsOAuth: false,
    },
    models: models.map((model) => ({
      id: model.id,
      modelId: model.id.slice(name.length + 1),
      name: model.name,
      provider: name,
      available: configured,
      availableThinkingLevels: [],
    })),
  } satisfies ProviderInfo
}

function seed() {
  usePreferencesStore.setState((state) => ({
    settings: { ...state.settings, enabledModels: [SONNET], selectedModel: SONNET },
  }))
  useProviderStore.setState({
    isLoading: false,
    providerModels: [
      provider('anthropic', 'Anthropic', false, [
        { id: SONNET, name: 'Claude Sonnet' },
        { id: HAIKU, name: 'Claude Haiku' },
      ]),
      provider('openrouter', 'OpenRouter', true, [
        { id: GPT, name: 'OpenAI: GPT-5' },
        { id: CODER, name: 'Qwen: Qwen3 Coder' },
      ]),
    ],
  })
}

function providersNav() {
  return screen.getByRole('navigation', { name: 'Providers' })
}

function modelCheckboxNames() {
  return screen.getAllByRole('checkbox').map((checkbox) => checkbox.closest('label')?.textContent)
}

describe('AvailableModelsSection', () => {
  beforeEach(() => {
    setEnabledModelsMock.mockReset()
    setEnabledModelsMock.mockResolvedValue(undefined)
    updateSettingsMock.mockReset()
    updateSettingsMock.mockResolvedValue({ ok: true })
    seed()
  })

  it('opens the first signed-in provider and switches provider from the sidebar', () => {
    render(<AvailableModelsSection />)

    expect(screen.getByText('of 4 models selected', { exact: false })).toBeInTheDocument()
    const openRouter = within(providersNav()).getByRole('button', { name: /OpenRouter/ })
    expect(openRouter).toHaveAttribute('aria-pressed', 'true')
    expect(modelCheckboxNames()).toEqual([
      expect.stringContaining('OpenAI: GPT-5'),
      expect.stringContaining('Qwen: Qwen3 Coder'),
    ])

    fireEvent.click(within(providersNav()).getByRole('button', { name: /Anthropic/ }))

    expect(modelCheckboxNames()).toEqual([
      expect.stringContaining('Claude Sonnet'),
      expect.stringContaining('Claude Haiku'),
    ])
    expect(screen.getByRole('checkbox', { name: /Claude Sonnet/ })).toBeChecked()
  })

  it('searches every provider and selects only the matching models', async () => {
    render(<AvailableModelsSection />)

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search models' }), {
      target: { value: 'claude' },
    })

    // The open provider has no match, so the list offers the matches elsewhere.
    fireEvent.click(screen.getByRole('button', { name: 'Show 2 matches in other providers' }))
    expect(within(providersNav()).getByRole('button', { name: /All providers/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByText('2 matching · 1 selected')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Select all 2 matching' }))

    await waitFor(() => expect(setEnabledModelsMock).toHaveBeenCalledWith([SONNET, HAIKU]))
  })

  it('narrows with filter chips and resets back to the full list', () => {
    render(<AvailableModelsSection />)
    fireEvent.click(within(providersNav()).getByRole('button', { name: /All providers/ }))

    const selectedChip = screen.getByRole('button', { name: /^Selected/ })
    expect(selectedChip).toHaveTextContent('1')
    fireEvent.click(selectedChip)

    expect(selectedChip).toHaveAttribute('aria-pressed', 'true')
    expect(modelCheckboxNames()).toEqual([expect.stringContaining('Claude Sonnet')])

    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }))

    expect(screen.getAllByRole('checkbox')).toHaveLength(4)
    expect(screen.queryByRole('button', { name: 'Reset filters' })).not.toBeInTheDocument()
  })

  it('toggles a single model on and off', async () => {
    render(<AvailableModelsSection />)

    fireEvent.click(screen.getByRole('checkbox', { name: /Qwen: Qwen3 Coder/ }))
    await waitFor(() => expect(setEnabledModelsMock).toHaveBeenLastCalledWith([SONNET, CODER]))

    fireEvent.click(within(providersNav()).getByRole('button', { name: /Anthropic/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Claude Sonnet/ }))
    await waitFor(() => expect(setEnabledModelsMock).toHaveBeenLastCalledWith([CODER]))
  })

  it("selects and clears one provider's models, keeping models enabled elsewhere", async () => {
    // Enabled in another project, so not in this catalog.
    const ELSEWHERE = SupportedModelId('qa-faux/luna')
    usePreferencesStore.setState((state) => ({
      settings: { ...state.settings, enabledModels: [SONNET, ELSEWHERE] },
    }))
    render(<AvailableModelsSection />)

    fireEvent.click(screen.getByRole('button', { name: 'Select all OpenRouter models' }))
    await waitFor(() =>
      expect(setEnabledModelsMock).toHaveBeenLastCalledWith([SONNET, ELSEWHERE, GPT, CODER]),
    )

    fireEvent.click(within(providersNav()).getByRole('button', { name: /Anthropic/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Deselect all Anthropic models' }))
    await waitFor(() =>
      expect(setEnabledModelsMock).toHaveBeenLastCalledWith([ELSEWHERE, GPT, CODER]),
    )
  })

  it('deselects only the matching models and announces the match count', async () => {
    usePreferencesStore.setState((state) => ({
      settings: { ...state.settings, enabledModels: [SONNET, HAIKU, GPT] },
    }))
    render(<AvailableModelsSection />)
    fireEvent.click(within(providersNav()).getByRole('button', { name: /All providers/ }))
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('')

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search models' }), {
      target: { value: 'claude' },
    })
    expect(status).toHaveTextContent('2 matching models')
    fireEvent.click(screen.getByRole('button', { name: 'Deselect matching' }))

    await waitFor(() => expect(setEnabledModelsMock).toHaveBeenLastCalledWith([GPT]))
  })

  it('clears the search on Escape before Escape reaches the rest of Settings', () => {
    const outerKeyDown = vi.fn()
    document.addEventListener('keydown', outerKeyDown)
    onTestFinished(() => document.removeEventListener('keydown', outerKeyDown))
    render(<AvailableModelsSection />)
    const search = screen.getByRole('searchbox', { name: 'Search models' })
    fireEvent.change(search, { target: { value: 'claude' } })

    fireEvent.keyDown(search, { key: 'Escape' })
    expect(search).toHaveValue('')
    expect(outerKeyDown).not.toHaveBeenCalled()

    fireEvent.keyDown(search, { key: 'Escape' })
    expect(outerKeyDown).toHaveBeenCalledTimes(1)
  })

  it('shows the first 100 models of a large list, then the rest on request', () => {
    const many = Array.from({ length: 105 }, (_, index) => ({
      id: SupportedModelId(`openrouter/vendor/model-${String(index).padStart(3, '0')}`),
      name: `Model ${String(index).padStart(3, '0')}`,
    }))
    useProviderStore.setState({
      isLoading: false,
      providerModels: [provider('openrouter', 'OpenRouter', true, many)],
    })
    render(<AvailableModelsSection />)

    expect(screen.getAllByRole('checkbox')).toHaveLength(100)
    fireEvent.click(screen.getByRole('button', { name: 'Show 5 more' }))
    expect(screen.getAllByRole('checkbox')).toHaveLength(105)
  })
})
