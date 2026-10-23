import { SupportedModelId } from '@shared/types/brand'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useProviderStore } from '@/features/providers/state/provider-store'
import { ModelSelector } from '../ModelSelector/ModelSelector'

vi.mock('@/shared/lib/ipc', () => ({ api: {} }))

const SETTINGS = {
  ...DEFAULT_SETTINGS,
  selectedModel: SupportedModelId('anthropic/claude-sonnet-4-5'),
  enabledModels: [SupportedModelId('anthropic/claude-sonnet-4-5')],
}

describe('ModelSelector without a provider catalog', () => {
  beforeEach(() => {
    useProviderStore.setState(useProviderStore.getInitialState())
  })

  it('says the provider catalog failed instead of reporting no models', () => {
    useProviderStore.setState({ loadError: 'Pi catalog unavailable', catalogHydrated: true })

    render(
      <ModelSelector
        value={SETTINGS.selectedModel}
        onChange={vi.fn()}
        settings={SETTINGS}
        providerModels={[]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /select model/i }))

    expect(screen.getByText("Couldn't load providers.")).toBeInTheDocument()
    expect(screen.getByText('Retry in Settings → Connections.')).toBeInTheDocument()
    expect(screen.queryByText('No models configured.')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Models' })).toBeInTheDocument()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('still points to Connections when the catalog loaded but no model is enabled', () => {
    useProviderStore.setState({ catalogHydrated: true })

    render(
      <ModelSelector
        value={SETTINGS.selectedModel}
        onChange={vi.fn()}
        settings={SETTINGS}
        providerModels={[]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /select model/i }))

    expect(screen.getByText('No models configured.')).toBeInTheDocument()
    expect(screen.queryByText("Couldn't load providers.")).not.toBeInTheDocument()
  })

  it('focuses the empty popup and closes it with Escape, returning focus to the picker', () => {
    useProviderStore.setState({ loadError: 'Pi catalog unavailable', catalogHydrated: true })

    render(
      <ModelSelector
        value={SETTINGS.selectedModel}
        onChange={vi.fn()}
        settings={SETTINGS}
        providerModels={[]}
      />,
    )
    const trigger = screen.getByRole('button', { name: /select model/i })
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
    fireEvent.click(trigger)

    const popup = screen.getByRole('dialog', { name: 'Models' })
    expect(popup).toHaveFocus()
    expect(popup).toHaveAccessibleDescription(
      "Couldn't load providers. Retry in Settings → Connections.",
    )
    fireEvent.keyDown(popup, { key: 'Escape' })

    expect(screen.queryByRole('dialog', { name: 'Models' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes the popup with Escape from the picker button too', () => {
    render(
      <ModelSelector
        value={SETTINGS.selectedModel}
        onChange={vi.fn()}
        settings={SETTINGS}
        providerModels={[]}
      />,
    )
    const trigger = screen.getByRole('button', { name: /select model/i })
    fireEvent.click(trigger)
    fireEvent.keyDown(trigger, { key: 'Escape' })

    expect(screen.queryByRole('dialog', { name: 'Models' })).not.toBeInTheDocument()
  })
})
