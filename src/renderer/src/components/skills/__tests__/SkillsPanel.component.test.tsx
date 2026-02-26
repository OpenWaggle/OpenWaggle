import type { SkillCatalogResult } from '@shared/types/standards'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SkillsPanel } from '../SkillsPanel'

const CATALOG: SkillCatalogResult = {
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

function renderPanel(previewMarkdown: string) {
  return render(
    <SkillsPanel
      projectPath="/tmp/project"
      standardsStatus={{ agents: 'found', agentsPath: '/tmp/project/AGENTS.md' }}
      catalog={CATALOG}
      selectedSkillId="skill-one"
      previewMarkdown={previewMarkdown}
      isLoading={false}
      isPreviewLoading={false}
      error={null}
      onRefresh={vi.fn()}
      onSelectSkill={vi.fn()}
      onToggleSkill={vi.fn()}
    />,
  )
}

describe('SkillsPanel markdown safety', () => {
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
    const highlightedToken = container.querySelector('span[class*="hljs-"]')

    expect(code).toBeTruthy()
    expect(code?.className).toContain('language-ts')
    expect(highlightedToken).toBeTruthy()
  })
})
