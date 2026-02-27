import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { usePreferencesStore } from '@/stores/preferences-store'
import { useProviderStore } from '@/stores/provider-store'
import { ConnectionsSection } from '../sections/ConnectionsSection'

function makeSettings(overrides: Partial<Settings>): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...overrides,
  }
}

describe('ConnectionsSection', () => {
  beforeEach(() => {
    usePreferencesStore.setState({
      ...usePreferencesStore.getInitialState(),
      settings: DEFAULT_SETTINGS,
      isLoaded: true,
      loadError: null,
    })
    useProviderStore.setState(useProviderStore.getInitialState())
    useAuthStore.setState(useAuthStore.getInitialState())
  })

  it('shows encryption warning when API keys exist and encryption is unavailable', () => {
    usePreferencesStore.setState({
      settings: makeSettings({
        encryptionAvailable: false,
        providers: {
          ...DEFAULT_SETTINGS.providers,
          openai: {
            ...DEFAULT_SETTINGS.providers.openai,
            apiKey: 'sk-test-openai',
            enabled: true,
          },
        },
      }),
    })

    render(<ConnectionsSection />)

    expect(
      screen.getByText(/your api keys are stored unencrypted on this system/i),
    ).toBeInTheDocument()
  })

  it('hides encryption warning when encryption is available', () => {
    usePreferencesStore.setState({
      settings: makeSettings({
        encryptionAvailable: true,
        providers: {
          ...DEFAULT_SETTINGS.providers,
          openai: {
            ...DEFAULT_SETTINGS.providers.openai,
            apiKey: 'sk-test-openai',
            enabled: true,
          },
        },
      }),
    })

    render(<ConnectionsSection />)

    expect(screen.queryByText(/your api keys are stored unencrypted on this system/i)).toBeNull()
  })

  it('hides encryption warning when no API keys are configured', () => {
    usePreferencesStore.setState({
      settings: makeSettings({
        encryptionAvailable: false,
      }),
    })

    render(<ConnectionsSection />)

    expect(screen.queryByText(/your api keys are stored unencrypted on this system/i)).toBeNull()
  })

  it('shows manual re-save warning when automatic re-encryption failed', () => {
    usePreferencesStore.setState({
      settings: makeSettings({
        encryptionAvailable: true,
        apiKeysRequireManualResave: true,
      }),
    })

    render(<ConnectionsSection />)

    expect(
      screen.getByText(/we could not re-encrypt one or more saved api keys automatically/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/please open each configured provider key and click save again/i),
    ).toBeInTheDocument()
  })
})
