import type { SkillCatalogResult } from '@shared/types/standards'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SkillsPanel } from '../SkillsPanel'

const mockState = vi.hoisted(() => {
  const catalog: SkillCatalogResult = {
    projectPath: '/tmp/project',
    skills: [
      {
        id: 'skill-one',
        name: 'Skill One',
        description: 'Test skill',
        folderPath: '/tmp/project/.openwaggle/skills/skill-one',
        skillPath: '/tmp/project/.openwaggle/skills/skill-one/SKILL.md',
        hasScripts: false,
        enabled: true,
        loadStatus: 'ok',
      },
    ],
  }

  return {
    previewMarkdown: '',
    catalog,
    projectPath: '/tmp/project',
    recentProjects: ['/tmp/other-project'],
    selectedSkillProject: '',
  }
})

vi.mock('@/features/sessions/hooks/useProject', () => ({
  useProject: () => ({
    projectPath: mockState.projectPath,
    selectFolder: vi.fn(),
    setProjectPath: vi.fn(),
  }),
}))

vi.mock('@/features/sessions/state', () => ({
  useSessionStore: (selector: (value: { sessions: { projectPath: string }[] }) => unknown) =>
    selector({ sessions: [] }),
}))

vi.mock('@/features/settings/state', () => ({
  usePreferencesStore: (
    selector: (value: {
      settings: { recentProjects: string[]; projectDisplayNames: Record<string, string> }
      pushRecentProject: () => Promise<void>
    }) => unknown,
  ) =>
    selector({
      settings: { recentProjects: mockState.recentProjects, projectDisplayNames: {} },
      pushRecentProject: vi.fn(async () => {}),
    }),
}))

vi.mock('@/features/skills/hooks/useSkills', () => ({
  useSkills: (projectPath: string) => {
    mockState.selectedSkillProject = projectPath
    return {
      standardsStatus: { agents: 'found' as const, agentsPath: '/tmp/project/AGENTS.md' },
      catalog:
        projectPath === '/tmp/project'
          ? mockState.catalog
          : {
              ...mockState.catalog,
              projectPath,
              skills: [{ ...mockState.catalog.skills[0], id: 'other-skill', name: 'Other Skill' }],
            },
      selectedSkillId: projectPath === '/tmp/project' ? 'skill-one' : 'other-skill',
      previewMarkdown: mockState.previewMarkdown,
      isLoading: false,
      isPreviewLoading: false,
      error: null,
      refresh: vi.fn(),
      selectSkill: vi.fn(),
      toggleSkill: vi.fn(),
    }
  },
}))

function renderPanel(previewMarkdown: string) {
  mockState.previewMarkdown = previewMarkdown
  return render(<SkillsPanel />)
}

describe('SkillsPanel markdown safety', () => {
  beforeEach(() => {
    mockState.previewMarkdown = ''
    mockState.projectPath = '/tmp/project'
    mockState.recentProjects = ['/tmp/other-project']
  })

  it('renders allowed links and blocks unsafe protocols', () => {
    renderPanel(
      '[good](https://example.com) [email](mailto:test@example.com) [bad](javascript:alert(1))',
    )

    expect(screen.getByRole('link', { name: 'good' })).toHaveAttribute(
      'href',
      'https://example.com',
    )
    expect(screen.getByRole('link', { name: 'email' })).toHaveAttribute(
      'href',
      'mailto:test@example.com',
    )
    expect(screen.queryByRole('link', { name: 'bad' })).toBeNull()
    expect(screen.getByText('bad')).toBeInTheDocument()
  })

  it('does not render raw HTML payloads as executable nodes', () => {
    const { container } = renderPanel('<img src=x onerror=alert(1) />')

    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
  })

  it('keeps syntax highlighting classes for fenced code', () => {
    const { container } = renderPanel('```ts\nconst x = 1\n```')
    const code = container.querySelector('code')

    expect(code).toBeTruthy()
    expect(code?.className).toContain('language-ts')
  })

  it('shows the standards file relative to the project', () => {
    renderPanel('')

    expect(screen.getAllByText('AGENTS.md')).toHaveLength(2)
    expect(screen.queryByText('/tmp/project/AGENTS.md')).toBeNull()
  })

  it('browses another project without changing the active project', () => {
    renderPanel('')

    fireEvent.click(screen.getByRole('button', { name: 'Project: project' }))
    fireEvent.click(screen.getByRole('button', { name: 'other-project (/tmp/other-project)' }))

    expect(screen.getByRole('button', { name: 'Project: other-project' })).toBeInTheDocument()
    expect(screen.getByText('Other Skill')).toBeInTheDocument()
    expect(mockState.selectedSkillProject).toBe('/tmp/other-project')
    expect(mockState.projectPath).toBe('/tmp/project')
  })
})
