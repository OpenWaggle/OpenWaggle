import type { ProviderInfo } from '@shared/types/llm'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { KeyEditor } from '../KeyEditor'

function providerInfo(auth: ProviderInfo['auth']): ProviderInfo {
  return {
    provider: 'openai',
    displayName: 'OpenAI',
    apiKeyManagementUrl: 'https://platform.openai.com/api-keys',
    auth,
    models: [],
  }
}

function apiKeyAuth(source: ProviderInfo['auth']['apiKeySource']): ProviderInfo['auth'] {
  return {
    configured: source !== 'none',
    source,
    apiKeyConfigured: source === 'api-key',
    apiKeySource: source,
    oauthConnected: false,
    supportsApiKey: true,
    supportsOAuth: false,
  }
}

describe('KeyEditor', () => {
  it('trims API keys before testing and saving, then closes the editor', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const onTest = vi.fn().mockResolvedValue(true)
    const onClose = vi.fn()

    render(
      <KeyEditor
        providerInfo={providerInfo(apiKeyAuth('none'))}
        onSave={onSave}
        onClear={vi.fn()}
        onTest={onTest}
        isTesting={false}
        testResult={null}
        onClose={onClose}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('Enter your OpenAI API key'), {
      target: { value: '  sk-test  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Test' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onTest).toHaveBeenCalledWith('sk-test')
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('sk-test'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('allows clearing a stored OpenWaggle-managed key', async () => {
    const onClear = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()

    render(
      <KeyEditor
        providerInfo={providerInfo(apiKeyAuth('api-key'))}
        onSave={vi.fn()}
        onClear={onClear}
        onTest={vi.fn()}
        isTesting={false}
        testResult={null}
        onClose={onClose}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

    await waitFor(() => expect(onClear).toHaveBeenCalledOnce())
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('shows environment/custom auth context without offering a local clear action', () => {
    render(
      <KeyEditor
        providerInfo={providerInfo(apiKeyAuth('environment-or-custom'))}
        onSave={vi.fn()}
        onClear={vi.fn()}
        onTest={vi.fn()}
        isTesting={false}
        testResult={{ success: false, error: 'Invalid key' }}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('Invalid key')).toBeInTheDocument()
    expect(screen.getByText(/Pi currently sees this provider/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument()
  })

  it('communicates successful tests and disables test while validation is running', () => {
    render(
      <KeyEditor
        providerInfo={providerInfo(apiKeyAuth('none'))}
        onSave={vi.fn()}
        onClear={vi.fn()}
        onTest={vi.fn()}
        isTesting
        testResult={{ success: true }}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('Connection successful')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Testing/ })).toBeDisabled()
  })
})
