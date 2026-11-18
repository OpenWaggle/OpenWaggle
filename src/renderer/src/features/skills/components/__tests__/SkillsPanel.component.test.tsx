import type { SkillCatalogResult } from '@shared/types/standards'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/features/chat/state'
import { useSessionStore } from '@/features/sessions/state'
import { usePreferencesStore } from '@/features/settings/state'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'

/*
 * Only the preload is replaced: the project picker, the resource-project hook, the skills
 * queries, the Markdown preview and the preference, chat and session stores are the real ones.
 */
const host = vi.hoisted(() => ({ previewMarkdown: '' }))

function catalogFor(projectPath: string) {
  const id = projectPath === '/tmp/project' ? 'skill-one' : 'other-skill'
  return {
    projectPath,
    skills: [
      {
        id,
        name: projectPath === '/tmp/project' ? 'Skill One' : 'Other Skill',
        description: 'Test skill',
        folderPath: `${projectPath}/.openwaggle/skills/${id}`,
        skillPath: `${projectPath}/.openwaggle/skills/${id}/SKILL.md`,
        hasScripts: false,
        enabled: true,
        loadStatus: 'ok',
      },
    ],
  } satisfies SkillCatalogResult
}

vi.mock('@/shared/lib/ipc', async () => ({
  api: (await import('@/test-utils/preload-api')).preloadApi({
    getStandardsStatus: async (projectPath: string) => ({
      agents: 'found' as const,
      agentsPath: `${projectPath}/AGENTS.md`,
    }),
    listSkills: async (projectPath: string) => catalogFor(projectPath),
    getSkillPreview: async () => ({ markdown: host.previewMarkdown }),
    listSessionProjectPage: async () => ({ paths: [], nextCursor: null }),
  }),
}))

import { SkillsPanel } from '../SkillsPanel'

const initialChat = useChatStore.getInitialState()
const initialSessions = useSessionStore.getInitialState()
const initialPreferences = usePreferencesStore.getInitialState()

beforeEach(() => {
  host.previewMarkdown = ''
  usePreferencesStore.setState({
    settings: {
      ...DEFAULT_SETTINGS,
      projectPath: '/tmp/project',
      recentProjects: ['/tmp/other-project'],
      projectDisplayNames: {},
    },
  })
})

afterEach(() => {
  useChatStore.setState(initialChat, true)
  useSessionStore.setState(initialSessions, true)
  usePreferencesStore.setState(initialPreferences, true)
})

/** Renders the panel and waits for the selected skill's preview to replace its spinner. */
async function renderPanel(previewMarkdown: string) {
  host.previewMarkdown = previewMarkdown
  const view = renderWithQueryClient(<SkillsPanel />)
  await screen.findByText('Skill One')
  await vi.waitFor(() => expect(screen.queryByText(/Loading preview/)).not.toBeInTheDocument())
  return view
}

describe('SkillsPanel markdown safety', () => {
  it('renders allowed links and blocks unsafe protocols', async () => {
    await renderPanel(
      '[good](https://example.com) [email](mailto:test@example.com) [bad](javascript:alert(1))',
    )

    expect(await screen.findByRole('link', { name: 'good' })).toHaveAttribute(
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

  it('does not render raw HTML payloads as executable nodes', async () => {
    const { container } = await renderPanel('<img src=x onerror=alert(1) /> after the payload')

    await screen.findByText(/after the payload/)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
  })

  it('keeps syntax highlighting classes for fenced code', async () => {
    const { container } = await renderPanel('```ts\nconst x = 1\n```')

    await vi.waitFor(() => expect(container.querySelector('code')).not.toBeNull())
    expect(container.querySelector('code')?.className).toContain('language-ts')
  })

  it('shows the standards file relative to the project, also after a refresh', async () => {
    await renderPanel('')

    expect(screen.getAllByText('AGENTS.md')).toHaveLength(2)
    expect(screen.queryByText('/tmp/project/AGENTS.md')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    await vi.waitFor(() => expect(screen.getAllByText('AGENTS.md')).toHaveLength(2))
    expect(screen.queryByText('/tmp/project/AGENTS.md')).toBeNull()
  })

  it('browses another project without changing the active project', async () => {
    await renderPanel('')

    fireEvent.click(screen.getByRole('button', { name: 'Project: project' }))
    fireEvent.click(screen.getByRole('button', { name: 'other-project (/tmp/other-project)' }))

    expect(screen.getByRole('button', { name: 'Project: other-project' })).toBeInTheDocument()
    expect(await screen.findByText('Other Skill')).toBeInTheDocument()
    expect(screen.queryByText('Skill One')).not.toBeInTheDocument()
    expect(usePreferencesStore.getState().settings.projectPath).toBe('/tmp/project')
  })
})
