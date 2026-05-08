import type { SkillCatalogResult } from '@shared/types/standards'
import { act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHookWithQueryClient } from '../../test-utils/query-test-utils'
import { useSkills } from '../useSkills'

const { getSkillPreviewMock, getStandardsStatusMock, listSkillsMock, setSkillEnabledMock } =
  vi.hoisted(() => ({
    getSkillPreviewMock: vi.fn(),
    getStandardsStatusMock: vi.fn(),
    listSkillsMock: vi.fn(),
    setSkillEnabledMock: vi.fn(),
  }))

vi.mock('@/lib/ipc', () => ({
  api: {
    getStandardsStatus: getStandardsStatusMock,
    listSkills: listSkillsMock,
    getSkillPreview: getSkillPreviewMock,
    setSkillEnabled: setSkillEnabledMock,
  },
}))

function createCatalog(skills: SkillCatalogResult['skills']): SkillCatalogResult {
  return {
    projectPath: '/tmp/project',
    skills,
  }
}

describe('useSkills', () => {
  beforeEach(() => {
    getSkillPreviewMock.mockReset()
    getStandardsStatusMock.mockReset()
    listSkillsMock.mockReset()
    setSkillEnabledMock.mockReset()
  })

  it('does not load when no project path is selected', () => {
    const { result } = renderHookWithQueryClient(() => useSkills(null))

    expect(result.current.catalog).toBeNull()
    expect(result.current.selectedSkillId).toBeNull()
    expect(result.current.previewMarkdown).toBe('')
    expect(getStandardsStatusMock).not.toHaveBeenCalled()
    expect(listSkillsMock).not.toHaveBeenCalled()
    expect(getSkillPreviewMock).not.toHaveBeenCalled()
  })

  it('loads skills resources and preview for the selected skill', async () => {
    getStandardsStatusMock.mockResolvedValueOnce({
      agents: 'found',
      agentsPath: '/tmp/project/AGENTS.md',
    })
    listSkillsMock.mockResolvedValueOnce(
      createCatalog([
        {
          id: 'skill-one',
          name: 'Skill One',
          description: 'First skill',
          folderPath: '/tmp/project/.openwaggle/skills/skill-one',
          skillPath: '/tmp/project/.openwaggle/skills/skill-one/SKILL.md',
          hasScripts: false,
          enabled: true,
          loadStatus: 'ok',
        },
      ]),
    )
    getSkillPreviewMock.mockResolvedValueOnce({ markdown: '# Skill One' })

    const { result } = renderHookWithQueryClient(() => useSkills('/tmp/project'))

    await waitFor(() => {
      expect(result.current.standardsStatus?.agents).toBe('found')
      expect(result.current.selectedSkillId).toBe('skill-one')
      expect(result.current.previewMarkdown).toBe('# Skill One')
    })
  })

  it('skips preview loading for invalid skills', async () => {
    getStandardsStatusMock.mockResolvedValueOnce({
      agents: 'found',
      agentsPath: '/tmp/project/AGENTS.md',
    })
    listSkillsMock.mockResolvedValueOnce(
      createCatalog([
        {
          id: 'broken-skill',
          name: 'Broken Skill',
          description: 'Invalid skill file',
          folderPath: '/tmp/project/.openwaggle/skills/broken-skill',
          skillPath: '/tmp/project/.openwaggle/skills/broken-skill/SKILL.md',
          hasScripts: false,
          enabled: true,
          loadStatus: 'error',
          loadError: 'invalid frontmatter',
        },
      ]),
    )

    const { result } = renderHookWithQueryClient(() => useSkills('/tmp/project'))

    await waitFor(() => {
      expect(result.current.selectedSkillId).toBe('broken-skill')
      expect(result.current.previewMarkdown).toBe('')
    })
    expect(getSkillPreviewMock).not.toHaveBeenCalled()
  })

  it('invalidates the catalog and preserves the selected skill after toggling', async () => {
    const catalog = createCatalog([
      {
        id: 'skill-one',
        name: 'Skill One',
        description: 'First skill',
        folderPath: '/tmp/project/.openwaggle/skills/skill-one',
        skillPath: '/tmp/project/.openwaggle/skills/skill-one/SKILL.md',
        hasScripts: false,
        enabled: true,
        loadStatus: 'ok',
      },
      {
        id: 'skill-two',
        name: 'Skill Two',
        description: 'Second skill',
        folderPath: '/tmp/project/.openwaggle/skills/skill-two',
        skillPath: '/tmp/project/.openwaggle/skills/skill-two/SKILL.md',
        hasScripts: false,
        enabled: false,
        loadStatus: 'ok',
      },
    ])

    getStandardsStatusMock.mockResolvedValue({
      agents: 'found',
      agentsPath: '/tmp/project/AGENTS.md',
    })
    listSkillsMock.mockResolvedValue(catalog)
    getSkillPreviewMock
      .mockResolvedValueOnce({ markdown: '# Skill One' })
      .mockResolvedValueOnce({ markdown: '# Skill Two' })
      .mockResolvedValueOnce({ markdown: '# Skill Two' })
      .mockResolvedValue({ markdown: '# Skill Two' })
      .mockResolvedValueOnce({ markdown: '# Skill Two' })
    setSkillEnabledMock.mockResolvedValueOnce(undefined)

    const { result } = renderHookWithQueryClient(() => useSkills('/tmp/project'))

    await waitFor(() => {
      expect(result.current.selectedSkillId).toBe('skill-one')
    })

    act(() => {
      result.current.selectSkill('skill-two')
    })

    await waitFor(() => {
      expect(result.current.previewMarkdown).toBe('# Skill Two')
    })

    await act(async () => {
      await result.current.toggleSkill('skill-two', true)
    })

    await waitFor(() => {
      expect(setSkillEnabledMock).toHaveBeenCalledWith('/tmp/project', 'skill-two', true)
      expect(listSkillsMock).toHaveBeenCalledTimes(2)
      expect(result.current.selectedSkillId).toBe('skill-two')
    })
  })

  it('falls back to the first available skill when the selected one disappears after refresh', async () => {
    const initialCatalog = createCatalog([
      {
        id: 'skill-one',
        name: 'Skill One',
        description: 'First skill',
        folderPath: '/tmp/project/.openwaggle/skills/skill-one',
        skillPath: '/tmp/project/.openwaggle/skills/skill-one/SKILL.md',
        hasScripts: false,
        enabled: true,
        loadStatus: 'ok',
      },
      {
        id: 'skill-two',
        name: 'Skill Two',
        description: 'Second skill',
        folderPath: '/tmp/project/.openwaggle/skills/skill-two',
        skillPath: '/tmp/project/.openwaggle/skills/skill-two/SKILL.md',
        hasScripts: false,
        enabled: true,
        loadStatus: 'ok',
      },
    ])
    const refreshedCatalog = createCatalog([initialCatalog.skills[0]])

    getStandardsStatusMock.mockResolvedValue({
      agents: 'found',
      agentsPath: '/tmp/project/AGENTS.md',
    })
    listSkillsMock.mockResolvedValueOnce(initialCatalog).mockResolvedValueOnce(refreshedCatalog)
    getSkillPreviewMock
      .mockResolvedValueOnce({ markdown: '# Skill One' })
      .mockResolvedValueOnce({ markdown: '# Skill Two' })

    const { result } = renderHookWithQueryClient(() => useSkills('/tmp/project'))

    await waitFor(() => {
      expect(result.current.selectedSkillId).toBe('skill-one')
    })

    act(() => {
      result.current.selectSkill('skill-two')
    })

    await waitFor(() => {
      expect(result.current.previewMarkdown).toBe('# Skill Two')
    })

    await act(async () => {
      await result.current.refresh()
    })

    await waitFor(() => {
      expect(listSkillsMock).toHaveBeenCalledTimes(2)
      expect(result.current.selectedSkillId).toBe('skill-one')
    })
  })
})
