import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  apiMocks,
  MCP_VIEW,
  PROJECT_PATH,
  resetMcpSectionTestState,
  SESSION_ID,
} from './mcp-section-test-utils'

const { McpSection } = await import('../sections/McpSection')
const { usePreferencesStore } = await import('@/features/settings/state/preferences-store')

const baseServer = MCP_VIEW.servers[0]

const SHARED_AND_REQUIRED_VIEW = {
  ...MCP_VIEW,
  integration: {
    ...MCP_VIEW.integration,
    desired: { ...MCP_VIEW.integration.desired, global: 'on' as const },
  },
  servers: [
    {
      ...baseServer,
      instanceId: 'srv-shared',
      name: 'shared-fs',
      sourceId: 'global-openwaggle' as const,
      enabled: true,
      trusted: 'untrusted' as const,
      required: false,
      projectEnabled: true,
    },
    {
      ...baseServer,
      instanceId: 'srv-required',
      name: 'must-run',
      sourceId: 'project-standard' as const,
      enabled: true,
      trusted: 'trusted' as const,
      required: true,
      projectEnabled: true,
    },
  ],
}

describe('McpSection per-project server detail', () => {
  beforeEach(() => {
    resetMcpSectionTestState()
    apiMocks.getMcpSettings.mockResolvedValue(SHARED_AND_REQUIRED_VIEW)
    usePreferencesStore.setState({
      ...usePreferencesStore.getInitialState(),
      settings: { ...DEFAULT_SETTINGS, projectPath: PROJECT_PATH },
      isLoaded: true,
      loadError: null,
    })
  })

  it('marks shared servers, scopes the hint to global, and offers no per-project toggle for required servers', async () => {
    render(<McpSection sessionId={SESSION_ID} />)

    // Shared (global-source) server is labelled shared and its untrusted hint is global-scoped.
    expect((await screen.findAllByText('shared')).length).toBeGreaterThan(0)
    expect(screen.getByText('Not trusted globally')).toBeInTheDocument()

    // A non-required shared server gets a per-project toggle...
    expect(
      screen.getByRole('switch', { name: 'Disable shared-fs for this project' }),
    ).toBeInTheDocument()
    // ...but a required server cannot be muted per project (Required pill, no toggle).
    expect(screen.getAllByText('Required').length).toBeGreaterThan(0)
    expect(
      screen.queryByRole('switch', { name: /must-run for this project/ }),
    ).not.toBeInTheDocument()
  })
})
