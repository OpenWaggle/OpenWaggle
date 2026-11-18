import { SessionId } from '@shared/types/brand'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/features/chat/state'
import { useProviderStore } from '@/features/providers/state'
import { useSessionStore } from '@/features/sessions/state'
import { usePreferencesStore } from '@/features/settings/state'
import type { SettingsTab } from '@/shell/ui-store'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { AppSettingsView } from '../AppSettingsView'
import { SettingsNav } from '../SettingsNav'
import { SettingsPage } from '../SettingsPage'

/*
 * Only the preload, the router and the two tabs that read whole Host catalogs are replaced:
 * the nav, the back-to-app hook, the chat, preference and provider stores, and the Skills,
 * Agents and Permissions tabs are the real ones. With no project open those tabs read nothing.
 */
const mocks = vi.hoisted(() => ({ navigate: vi.fn() }))

vi.mock('@/shared/lib/ipc', async () => ({
  api: (await import('@/test-utils/preload-api')).preloadApi({
    getProviderModels: async () => [],
    getAuthAccountInfos: async () => ({}),
    listSessionProjectPage: async () => ({ paths: [], nextCursor: null }),
  }),
}))
// Settings navigation targets the app route tree, which a component test does not build.
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }))
// The MCP tab reads the server registry and the Connections tab every provider's sign-in; each
// has its own tests, and here they only show which tab is mounted.
vi.mock('../sections/McpSection', () => ({ McpSection: () => <div>MCP settings</div> }))
vi.mock('../sections/ConnectionsSection', () => ({
  ConnectionsSection: () => <div>Connections settings</div>,
}))

const initialChat = useChatStore.getInitialState()
const initialSessions = useSessionStore.getInitialState()
const initialPreferences = usePreferencesStore.getInitialState()
const initialProviders = useProviderStore.getInitialState()

beforeEach(() => {
  mocks.navigate.mockReset()
  // No project is open, so the resource tabs show their empty state without reading the Host.
  usePreferencesStore.setState({
    settings: { ...DEFAULT_SETTINGS, projectPath: null, recentProjects: [] },
  })
})

afterEach(() => {
  useChatStore.setState(initialChat, true)
  useSessionStore.setState(initialSessions, true)
  usePreferencesStore.setState(initialPreferences, true)
  useProviderStore.setState(initialProviders, true)
})

function navButton(name: RegExp) {
  return within(screen.getByRole('navigation')).getByRole('button', { name })
}

describe('settings shell components', () => {
  it.each([
    { label: /Waggle Mode/, to: { to: '/settings/$tab', params: { tab: 'waggle' } } },
    { label: /Extensions/, to: { to: '/settings/$tab', params: { tab: 'extensions' } } },
    { label: /^Skills$/, to: { to: '/settings/$tab', params: { tab: 'skills' } } },
    { label: /^Agents$/, to: { to: '/settings/$tab', params: { tab: 'agents' } } },
    { label: /General/, to: { to: '/settings' } },
  ])('navigates to the $label tab from the nav', ({ label, to }) => {
    renderWithQueryClient(<SettingsNav activeTab="general" />)

    fireEvent.click(navButton(label))

    expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith(to)
  })

  it('navigates from the narrow-window section picker', () => {
    renderWithQueryClient(<SettingsNav activeTab="general" />)

    fireEvent.change(screen.getByRole('combobox', { name: 'Settings section' }), {
      target: { value: 'mcp' },
    })

    expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith({
      to: '/settings/$tab',
      params: { tab: 'mcp' },
    })
  })

  it('lists active tabs only, active and inactive items in the same layout position', () => {
    renderWithQueryClient(<SettingsNav activeTab="extensions" />)

    expect(screen.queryByRole('button', { name: /Git/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Personalization/ })).not.toBeInTheDocument()
    expect(navButton(/Worktrees/)).toBeInTheDocument()
    expect(navButton(/Extensions/)).toHaveClass('w-full', 'justify-start')
    expect(navButton(/Waggle Mode/)).toHaveClass('w-full', 'justify-start')
  })

  it('routes back to the active session from the settings page header', () => {
    useChatStore.setState({ activeSessionId: SessionId('session-1') })

    renderWithQueryClient(<SettingsPage activeTab="connections" />)
    fireEvent.click(screen.getByRole('button', { name: /Back to app/ }))

    expect(screen.getByText('Connections settings')).toBeInTheDocument()
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/sessions/$sessionId',
      params: { sessionId: 'session-1' },
    })
  })

  it.each<{ tab: SettingsTab; shows: string; hive: boolean }>([
    { tab: 'skills', shows: 'Open a project folder to browse its skills.', hive: false },
    { tab: 'agents', shows: 'Open a project folder to browse its agents.', hive: true },
    { tab: 'permissions', shows: 'Access modes and saved approvals.', hive: false },
  ])('renders the $tab tab, with Hive controls only beside agents', ({ tab, shows, hive }) => {
    renderWithQueryClient(<SettingsPage activeTab={tab} />)

    expect(screen.getByText(shows)).toBeInTheDocument()
    expect(navButton(new RegExp(`^${tab}$`, 'i'))).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Hive controls' }) !== null).toBe(hive)
  })

  it('renders AppSettingsView through the panel boundary', () => {
    renderWithQueryClient(<AppSettingsView activeTab="mcp" />)

    expect(screen.getByText('MCP settings')).toBeInTheDocument()
    expect(screen.getByText('Settings')).toBeInTheDocument()
  })
})
