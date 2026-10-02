import { SESSION_TITLE_MODEL_AUTOMATIC } from '@shared/session-title-model'
import { SupportedModelId } from '@shared/types/brand'
import type { ProviderInfo } from '@shared/types/llm'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useProviderStore } from '@/features/providers/state'
import { usePreferencesStore } from '@/features/settings/state'
import { TitleModelCopy, TitleModelSection } from '../TitleModelSection'

const { updateSettingsMock } = vi.hoisted(() => ({
  updateSettingsMock: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    updateSettings: updateSettingsMock,
  },
}))

const HAIKU = SupportedModelId('anthropic/claude-haiku')
const MINI = SupportedModelId('openai/gpt-mini')
const UNLISTED = SupportedModelId('openai/gpt-unlisted')

function provider(
  name: ProviderInfo['provider'],
  displayName: string,
  models: readonly { readonly id: SupportedModelId; readonly name: string }[],
) {
  return {
    provider: name,
    displayName,
    auth: {
      configured: true,
      source: 'api-key',
      apiKeyConfigured: true,
      apiKeySource: 'api-key',
      oauthConnected: false,
      supportsApiKey: true,
      supportsOAuth: false,
    },
    models: models.map((model) => ({
      id: model.id,
      modelId: model.id.split('/')[1] ?? model.id,
      name: model.name,
      provider: name,
      available: true,
      availableThinkingLevels: [],
    })),
  } satisfies ProviderInfo
}

function seed(enabledModels: readonly SupportedModelId[]) {
  usePreferencesStore.setState((state) => ({
    settings: {
      ...state.settings,
      enabledModels: [...enabledModels],
      sessionTitleModel: SESSION_TITLE_MODEL_AUTOMATIC,
    },
  }))
  useProviderStore.setState({
    providerModels: [
      provider('anthropic', 'Anthropic', [{ id: HAIKU, name: 'Claude Haiku' }]),
      provider('openai', 'OpenAI', [
        { id: MINI, name: 'GPT Mini' },
        { id: UNLISTED, name: 'GPT Unlisted' },
      ]),
    ],
  })
}

function titleModelSelect() {
  return screen.getByRole('combobox', { name: 'Title model' })
}

describe('TitleModelSection', () => {
  beforeEach(() => {
    updateSettingsMock.mockReset()
    updateSettingsMock.mockResolvedValue({ ok: true })
    seed([HAIKU, MINI])
  })

  it('defaults to Automatic and lists Off plus each enabled model by display name', () => {
    render(<TitleModelSection />)

    const select = titleModelSelect()
    expect(select).toHaveValue(SESSION_TITLE_MODEL_AUTOMATIC)
    const options = within(select)
      .getAllByRole('option')
      .map((option) => option.textContent)
    expect(options).toEqual(['Automatic', 'Off', 'Claude Haiku', 'GPT Mini'])
    expect(screen.getByText(TitleModelCopy.automaticHelp)).toBeInTheDocument()
    expect(screen.queryByText(TitleModelCopy.selectedModelNote)).not.toBeInTheDocument()
  })

  it('persists Off and explains that sessions keep their first message', async () => {
    render(<TitleModelSection />)

    fireEvent.change(titleModelSelect(), { target: { value: 'off' } })

    await waitFor(() =>
      expect(updateSettingsMock).toHaveBeenCalledWith({ sessionTitleModel: 'off' }),
    )
    await waitFor(() => expect(titleModelSelect()).toHaveValue('off'))
    expect(screen.getByText(TitleModelCopy.offHelp)).toBeInTheDocument()
  })

  it('persists a selected model and warns where titles are sent', async () => {
    render(<TitleModelSection />)

    fireEvent.change(titleModelSelect(), { target: { value: MINI } })

    await waitFor(() =>
      expect(updateSettingsMock).toHaveBeenCalledWith({ sessionTitleModel: MINI }),
    )
    await waitFor(() => expect(titleModelSelect()).toHaveValue(MINI))
    expect(screen.getByRole('note')).toHaveTextContent(TitleModelCopy.selectedModelNote)
  })

  it('keeps showing a selected model after it is no longer enabled', () => {
    usePreferencesStore.setState((state) => ({
      settings: { ...state.settings, sessionTitleModel: UNLISTED },
    }))
    render(<TitleModelSection />)

    expect(titleModelSelect()).toHaveValue(UNLISTED)
    expect(
      within(titleModelSelect()).getByRole('option', { name: 'GPT Unlisted' }),
    ).toBeInTheDocument()
  })
})
