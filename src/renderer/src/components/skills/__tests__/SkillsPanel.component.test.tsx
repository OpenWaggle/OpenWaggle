import type { SkillCatalogResult } from '@shared/types/standards'
import { render, screen } from '@testing-library/react'
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
  }
})

vi.mock('@/hooks/useProject', () => ({
  useProject: () => ({
    projectPath: '/tmp/project',
    selectFolder: vi.fn(),
    setProjectPath: vi.fn(),
  }),
}))

vi.mock('@/hooks/useSkills', () => ({
  useSkills: () => ({
    standardsStatus: { agents: 'found' as const, agentsPath: '/tmp/project/AGENTS.md' },
    catalog: mockState.catalog,
    selectedSkillId: 'skill-one',
    previewMarkdown: mockState.previewMarkdown,
    isLoading: false,
    isPreviewLoading: false,
    error: null,
    refresh: vi.fn(),
    selectSkill: vi.fn(),
    toggleSkill: vi.fn(),
  }),
}))

function renderPanel(previewMarkdown: string) {
  mockState.previewMarkdown = previewMarkdown
  return render(<SkillsPanel />)
}

describe('SkillsPanel markdown safety', () => {
  beforeEach(() => {
    mockState.previewMarkdown = ''
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
})
