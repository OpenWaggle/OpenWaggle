import type { AgentDefinitionDisplayItem } from '@shared/types/agent-definition'
import { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { fireEvent, screen } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/features/chat/state'
import { useSessionStore } from '@/features/sessions/state'
import { usePreferencesStore } from '@/features/settings/state'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'

/*
 * Only the preload is replaced: the project picker, the resource-project hook, the Agent
 * definitions queries and the preference, chat and session stores are the real ones. The fake
 * Host keeps each project's definitions, so a toggle shows up as the re-read the panel displays.
 */
const host = vi.hoisted(() => {
  // Declared property types are not narrowed, so a test can set projects and a folder.
  const initial: { readonly olderProjects: string[]; readonly selectedFolder: string | null } = {
    olderProjects: [],
    selectedFolder: null,
  }
  return {
    disabled: new Set<string>(),
    ...initial,
    listSessionProjectPage: vi.fn(),
    updateSettings: vi.fn(),
  }
})

/** One definition per project: `reviewer` in the active project, `explorer` elsewhere. */
function definitionName(projectPath: string) {
  return projectPath === '/tmp/project' ? 'reviewer' : 'explorer'
}

vi.mock('@/shared/lib/ipc', async () => ({
  api: (await import('@/test-utils/preload-api')).preloadApi({
    listAgentDefinitionDisplay: async (projectPath: string) => {
      const name = definitionName(projectPath)
      const item: AgentDefinitionDisplayItem[] = [
        {
          name,
          description: 'Reviews changes',
          scope: 'portable-project',
          sourcePath: `${projectPath}/.agents/agents/agent.md`,
          enabled: !host.disabled.has(`${projectPath}:${name}`),
        },
      ]
      return item
    },
    getAgentDefinitionPreview: async (_projectPath: string, name: string) => ({
      markdown: `---\nname: ${name}\ndescription: Reviews changes\n---\n\n# Review instructions`,
    }),
    setAgentDefinitionEnabled: async (projectPath: string, name: string, enabled: boolean) => {
      if (enabled) host.disabled.delete(`${projectPath}:${name}`)
      else host.disabled.add(`${projectPath}:${name}`)
    },
    selectProjectFolder: async () => host.selectedFolder,
    updateSettings: host.updateSettings,
    listSessionProjectPage: host.listSessionProjectPage,
  }),
}))

import { AgentDefinitionsPanel } from '../AgentDefinitionsPanel'

const initialChat = useChatStore.getInitialState()
const initialSessions = useSessionStore.getInitialState()
const initialPreferences = usePreferencesStore.getInitialState()

beforeEach(() => {
  host.disabled.clear()
  host.selectedFolder = '/tmp/new-project'
  host.listSessionProjectPage.mockReset().mockImplementation(async () => ({
    paths: host.olderProjects,
    nextCursor: null,
  }))
  host.olderProjects = []
  host.updateSettings.mockReset().mockResolvedValue({ ok: true })
  usePreferencesStore.setState({
    settings: {
      ...DEFAULT_SETTINGS,
      projectPath: '/tmp/project',
      recentProjects: ['/tmp/other-project'],
      projectDisplayNames: {
        '/tmp/other-project': 'Other project',
        '/tmp/display-name-only': 'Not a known project',
      },
    },
  })
  useSessionStore.setState({
    sessions: [
      fromPartial<SessionSummary>({
        id: SessionId('session'),
        projectPath: '/tmp/session-project',
      }),
    ],
  })
})

afterEach(() => {
  useChatStore.setState(initialChat, true)
  useSessionStore.setState(initialSessions, true)
  usePreferencesStore.setState(initialPreferences, true)
})

const activeProject = () => usePreferencesStore.getState().settings.projectPath

function openPicker(label: string) {
  fireEvent.click(screen.getByRole('button', { name: `Project: ${label}` }))
}

describe('Agents read-only browser', () => {
  it('shows Markdown frontmatter and instructions without editing controls', async () => {
    renderWithQueryClient(<AgentDefinitionsPanel />)

    expect(await screen.findByRole('region', { name: 'Agent frontmatter' })).toHaveTextContent(
      'name: reviewer',
    )
    expect(screen.getByRole('heading', { name: 'Review instructions' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Disable reviewer' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /edit|import|delete/i })).not.toBeInTheDocument()
  })

  it('disables a definition for future Sessions and shows it as disabled', async () => {
    renderWithQueryClient(<AgentDefinitionsPanel />)

    fireEvent.click(await screen.findByRole('switch', { name: 'Disable reviewer' }))

    expect(await screen.findByRole('switch', { name: 'Enable reviewer' })).toBeInTheDocument()
    expect(screen.getByText('Disabled for new sessions')).toBeInTheDocument()
    // The open definition's preview stays through the re-read.
    expect(screen.getByRole('region', { name: 'Agent frontmatter' })).toHaveTextContent(
      'name: reviewer',
    )
  })

  it('browses recent and session-backed projects without changing the active project', async () => {
    renderWithQueryClient(<AgentDefinitionsPanel />)

    openPicker('project')
    // A display name alone does not make a project known.
    expect(
      screen.queryByRole('button', { name: 'Not a known project (/tmp/display-name-only)' }),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Other project (/tmp/other-project)' }))
    expect(screen.getByRole('button', { name: 'Project: Other project' })).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('switch', { name: 'Disable explorer' }))
    // The toggle lands on the browsed project, not the active one.
    expect(await screen.findByRole('switch', { name: 'Enable explorer' })).toBeInTheDocument()
    expect(host.disabled).toEqual(new Set(['/tmp/other-project:explorer']))
    expect(activeProject()).toBe('/tmp/project')

    openPicker('Other project')
    fireEvent.click(screen.getByRole('button', { name: 'session-project (/tmp/session-project)' }))
    expect(screen.getByRole('button', { name: 'Project: session-project' })).toBeInTheDocument()
  })

  it('adds a newly opened folder to the project picker', async () => {
    renderWithQueryClient(<AgentDefinitionsPanel />)
    openPicker('project')
    fireEvent.click(screen.getByRole('button', { name: 'Open project folder…' }))

    expect(await screen.findByRole('button', { name: 'Project: new-project' })).toBeInTheDocument()
    expect(usePreferencesStore.getState().settings.recentProjects).toEqual([
      '/tmp/other-project',
      '/tmp/new-project',
    ])
    expect(activeProject()).toBe('/tmp/project')
  })

  it('names a refused recent-project write and keeps the project it browsed', async () => {
    host.updateSettings.mockResolvedValue({ ok: false, error: 'Settings are read-only.' })
    renderWithQueryClient(<AgentDefinitionsPanel />)
    openPicker('project')
    fireEvent.click(screen.getByRole('button', { name: 'Open project folder…' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Settings are read-only.')
    expect(screen.getByRole('button', { name: 'Project: project' })).toBeInTheDocument()
  })

  it('browses an older project returned by the Host instead of the loaded Session slice', async () => {
    host.olderProjects = ['/tmp/ancient-project']
    renderWithQueryClient(<AgentDefinitionsPanel />)
    openPicker('project')
    fireEvent.click(
      await screen.findByRole('button', { name: 'ancient-project (/tmp/ancient-project)' }),
    )

    expect(host.listSessionProjectPage).toHaveBeenCalledWith(100, undefined, '')
    expect(screen.getByRole('button', { name: 'Project: ancient-project' })).toBeInTheDocument()
    expect(await screen.findByRole('switch', { name: 'Disable explorer' })).toBeInTheDocument()
    expect(activeProject()).toBe('/tmp/project')
  })

  it('asks for a project folder when no project is known', () => {
    usePreferencesStore.setState({
      settings: { ...DEFAULT_SETTINGS, projectPath: null, recentProjects: [] },
    })
    useSessionStore.setState({ sessions: [] })
    renderWithQueryClient(<AgentDefinitionsPanel />)

    expect(screen.getByText('Open a project folder to browse its agents.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled()
  })
})
