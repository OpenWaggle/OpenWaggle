import { SupportedModelId } from '@shared/types/brand'
import type { ProviderInfo } from '@shared/types/llm'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useProviderStore } from '@/features/providers/state'
import { usePreferencesStore } from '@/features/settings/state'
import { ProviderRestrictionsSection } from '../ProviderRestrictionsSection'

const { updateSettingsMock } = vi.hoisted(() => ({
  updateSettingsMock: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    updateSettings: updateSettingsMock,
    selectProjectFolder: vi.fn(),
  },
}))

const WORK_FOLDER = '/Users/someone/Projects/work'
const PERSONAL_FOLDER = '/Users/someone/Projects/personal'

function provider(name: string, displayName: string) {
  const id = SupportedModelId(`${name}/model`)
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
    models: [
      {
        id,
        modelId: 'model',
        name: displayName,
        provider: name,
        available: true,
        availableThinkingLevels: [],
      },
    ],
  } satisfies ProviderInfo
}

function seed(input: {
  readonly appWide: Record<string, boolean | readonly string[]>
  readonly byPath: Record<string, Record<string, boolean | readonly string[]>>
}) {
  usePreferencesStore.setState((state) => ({
    settings: {
      ...state.settings,
      enabledModels: [SupportedModelId('anthropic/model')],
      providerRestrictions: input.appWide,
      providerRestrictionsByPath: input.byPath,
    },
  }))
  useProviderStore.setState({
    providerModels: [
      provider('amazon-bedrock', 'Amazon Bedrock'),
      provider('anthropic', 'Anthropic'),
      provider('github-copilot', 'GitHub Copilot'),
    ],
  })
}

function scopeToggle(label: string) {
  return screen.getByRole('button', { name: new RegExp(`^${label}`, 'u') })
}

describe('ProviderRestrictionsSection', () => {
  beforeEach(() => {
    updateSettingsMock.mockReset()
    updateSettingsMock.mockResolvedValue({ ok: true })
    seed({
      appWide: { 'amazon-bedrock': false, 'github-copilot': false },
      byPath: {
        [WORK_FOLDER]: { only: ['amazon-bedrock', 'github-copilot'] },
        [PERSONAL_FOLDER]: {},
      },
    })
  })

  it('collapses each configured scope to a summary of what it says', () => {
    render(<ProviderRestrictionsSection />)

    const work = scopeToggle(WORK_FOLDER)
    expect(work).toHaveAttribute('aria-expanded', 'false')
    expect(work).toHaveTextContent('Only Amazon Bedrock, GitHub Copilot')
    expect(scopeToggle('Every project')).toHaveTextContent(
      'Blocked: Amazon Bedrock, GitHub Copilot',
    )
    expect(
      screen.queryByRole('combobox', { name: `Anthropic in ${WORK_FOLDER}` }),
    ).not.toBeInTheDocument()
  })

  it('expands a scope to edit its providers, and collapses it again', () => {
    render(<ProviderRestrictionsSection />)

    fireEvent.click(scopeToggle(WORK_FOLDER))

    expect(scopeToggle(WORK_FOLDER)).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('combobox', { name: `Anthropic in ${WORK_FOLDER}` })).toHaveValue(
      'blocked',
    )

    fireEvent.click(scopeToggle(WORK_FOLDER))

    expect(
      screen.queryByRole('combobox', { name: `Anthropic in ${WORK_FOLDER}` }),
    ).not.toBeInTheDocument()
  })

  it('opens a scope that sets nothing yet, such as a folder just added', () => {
    render(<ProviderRestrictionsSection />)

    const personal = scopeToggle(PERSONAL_FOLDER)
    expect(personal).toHaveAttribute('aria-expanded', 'true')
    expect(personal).toHaveTextContent('No providers set')
    expect(
      screen.getByRole('combobox', { name: `Anthropic in ${PERSONAL_FOLDER}` }),
    ).toBeInTheDocument()
  })

  it('turns only on without refusing anything: the list starts as what the scope inherits', () => {
    seed({ appWide: {}, byPath: {} })
    render(<ProviderRestrictionsSection />)

    fireEvent.click(
      screen.getByRole('switch', {
        name: 'Restrict Every project (app-wide) to only the providers allowed here',
      }),
    )

    expect(updateSettingsMock).toHaveBeenCalledWith({
      providerRestrictions: { only: ['amazon-bedrock', 'anthropic', 'github-copilot'] },
    })
  })

  it('keeps a provider the scope inherits as blocked out of the only list it starts', () => {
    seed({
      appWide: { 'amazon-bedrock': false },
      byPath: { [WORK_FOLDER]: { anthropic: false } },
    })
    render(<ProviderRestrictionsSection />)

    fireEvent.click(
      screen.getByRole('switch', {
        name: `Restrict ${WORK_FOLDER} to only the providers allowed here`,
      }),
    )

    expect(updateSettingsMock).toHaveBeenCalledWith({
      providerRestrictionsByPath: {
        [WORK_FOLDER]: { anthropic: false, only: ['github-copilot'] },
      },
    })
  })

  it('offers only Allowed and Blocked while a scope is closed to its only list', () => {
    render(<ProviderRestrictionsSection />)
    fireEvent.click(scopeToggle(WORK_FOLDER))

    const select = screen.getByRole('combobox', { name: `Anthropic in ${WORK_FOLDER}` })
    expect([...select.querySelectorAll('option')].map((option) => option.value)).toEqual([
      'allowed',
      'blocked',
    ])
  })

  it('keeps the only toggle and removal on a collapsed scope', () => {
    render(<ProviderRestrictionsSection />)
    expect(scopeToggle(WORK_FOLDER)).toHaveAttribute('aria-expanded', 'false')

    expect(
      screen.getByRole('switch', {
        name: `Restrict ${WORK_FOLDER} to only the providers allowed here`,
      }),
    ).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: `Remove provider scope ${WORK_FOLDER}` }))

    expect(updateSettingsMock).toHaveBeenCalledWith({
      providerRestrictionsByPath: { [PERSONAL_FOLDER]: {} },
    })
  })
})
