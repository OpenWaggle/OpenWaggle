import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentDefinitionsPanel } from '../AgentDefinitionsPanel'

const state = vi.hoisted(() => ({
  toggleAgent: vi.fn(),
  selectAgent: vi.fn(),
  selectFolder: vi.fn(async () => '/tmp/new-project'),
  pushRecentProject: vi.fn(async (path: string) => {
    state.settings.recentProjects = [...state.settings.recentProjects, path]
  }),
  settings: {
    projectPath: '/tmp/project',
    recentProjects: ['/tmp/other-project'],
    projectDisplayNames: { '/tmp/other-project': 'Other project' },
  },
}))

vi.mock('@/features/sessions/hooks', () => ({
  useProject: () => ({ projectPath: state.settings.projectPath, selectFolder: state.selectFolder }),
}))

vi.mock('@/features/sessions/state', () => ({
  useSessionStore: (selector: (value: { sessions: { projectPath: string }[] }) => unknown) =>
    selector({ sessions: [{ projectPath: '/tmp/session-project' }] }),
}))

vi.mock('@/features/settings/state', () => ({
  usePreferencesStore: (selector: (value: typeof state) => unknown) =>
    selector({ ...state, settings: state.settings }),
}))

vi.mock('../../hooks/useAgentDefinitions', () => ({
  useAgentDefinitions: (projectPath: string | null) => ({
    items: projectPath
      ? [
          {
            name: projectPath === '/tmp/project' ? 'reviewer' : 'explorer',
            description: 'Reviews changes',
            scope: 'portable-project' as const,
            sourcePath: `${projectPath}/.agents/agents/agent.md`,
            enabled: true,
          },
        ]
      : [],
    selectedName: projectPath === '/tmp/project' ? 'reviewer' : 'explorer',
    selectAgent: state.selectAgent,
    toggleAgent: (name: string, enabled: boolean) => state.toggleAgent(projectPath, name, enabled),
    previewMarkdown: `---\nname: ${projectPath === '/tmp/project' ? 'reviewer' : 'explorer'}\ndescription: Reviews changes\n---\n\n# Review instructions`,
    isLoading: false,
    isPreviewLoading: false,
    error: null,
    refresh: vi.fn(),
  }),
}))

describe('Agents read-only browser', () => {
  beforeEach(() => {
    state.toggleAgent.mockClear()
    state.selectFolder.mockClear()
    state.pushRecentProject.mockClear()
    state.settings.recentProjects = ['/tmp/other-project']
  })

  it('shows Markdown frontmatter and instructions without editing controls', () => {
    render(<AgentDefinitionsPanel />)

    expect(screen.getByRole('region', { name: 'Agent frontmatter' })).toHaveTextContent(
      'name: reviewer',
    )
    expect(screen.getByRole('heading', { name: 'Review instructions' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Disable reviewer' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /edit|import|delete/i })).not.toBeInTheDocument()
  })

  it('can disable a definition for future Sessions', () => {
    render(<AgentDefinitionsPanel />)
    fireEvent.click(screen.getByRole('switch', { name: 'Disable reviewer' }))
    expect(state.toggleAgent).toHaveBeenCalledWith('/tmp/project', 'reviewer', false)
  })

  it('browses recent and session-backed projects without changing the active project', () => {
    render(<AgentDefinitionsPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Project: project' }))
    fireEvent.click(screen.getByRole('button', { name: 'Other project' }))
    expect(screen.getByRole('button', { name: 'Project: Other project' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Disable explorer' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('switch', { name: 'Disable explorer' }))
    expect(state.toggleAgent).toHaveBeenCalledWith('/tmp/other-project', 'explorer', false)
    expect(state.settings.projectPath).toBe('/tmp/project')

    fireEvent.click(screen.getByRole('button', { name: 'Project: Other project' }))
    fireEvent.click(screen.getByRole('button', { name: 'session-project' }))
    expect(screen.getByRole('button', { name: 'Project: session-project' })).toBeInTheDocument()
  })

  it('adds a newly opened folder to the project picker', async () => {
    render(<AgentDefinitionsPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Project: project' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open project folder…' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Project: new-project' })).toBeInTheDocument()
    })
    expect(state.pushRecentProject).toHaveBeenCalledWith('/tmp/new-project')
    expect(state.settings.projectPath).toBe('/tmp/project')
  })
})
