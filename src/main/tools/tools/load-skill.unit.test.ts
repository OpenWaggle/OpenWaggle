import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ConversationId } from '@shared/types/brand'
import { afterEach, describe, expect, it } from 'vitest'
import type { ToolContext } from '../define-tool'
import { loadSkillForRun } from './load-skill'

const tempDirs: string[] = []

async function makeTempProject(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'openhive-load-skill-tool-'))
  tempDirs.push(dir)
  return dir
}

async function writeSkill(projectPath: string, folder: string, content: string): Promise<void> {
  const skillDir = path.join(projectPath, '.openhive', 'skills', folder)
  await fs.mkdir(skillDir, { recursive: true })
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), content, 'utf8')
}

function makeContext(
  projectPath: string,
  overrides?: {
    toggles?: Record<string, boolean>
    loadedSkillIds?: Set<string>
  },
): ToolContext {
  return {
    conversationId: ConversationId('conv-load-skill-tool'),
    projectPath,
    dynamicSkills: {
      loadedSkillIds: overrides?.loadedSkillIds ?? new Set<string>(),
      toggles: overrides?.toggles ?? {},
    },
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('loadSkillForRun', () => {
  it('returns full skill instructions for a valid enabled skill', async () => {
    const projectPath = await makeTempProject()
    await writeSkill(
      projectPath,
      'code-review',
      `---
name: code-review
description: Review code changes.
---

Use strict checks.`,
    )

    const result = await loadSkillForRun(makeContext(projectPath), 'code-review')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.skillId).toBe('code-review')
      expect(result.instructions).toContain('Use strict checks.')
      expect(result.alreadyLoaded).toBe(false)
    }
  })

  it('rejects disabled skills', async () => {
    const projectPath = await makeTempProject()
    await writeSkill(
      projectPath,
      'frontend-design',
      `---
name: frontend-design
description: Build polished interfaces.
---

Body`,
    )

    const result = await loadSkillForRun(
      makeContext(projectPath, {
        toggles: { 'frontend-design': false },
      }),
      'frontend-design',
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('disabled')
    }
  })

  it('returns structured errors for malformed skills', async () => {
    const projectPath = await makeTempProject()
    await writeSkill(projectPath, 'broken-skill', '# invalid')

    const result = await loadSkillForRun(makeContext(projectPath), 'broken-skill')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('missing YAML frontmatter')
    }
  })

  it('rejects invalid skill id traversal attempts', async () => {
    const projectPath = await makeTempProject()

    const result = await loadSkillForRun(makeContext(projectPath), '../secrets')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('Invalid skill id')
    }
  })

  it('marks repeated calls as alreadyLoaded and dedupes run state', async () => {
    const projectPath = await makeTempProject()
    await writeSkill(
      projectPath,
      'repeatable-skill',
      `---
name: repeatable-skill
description: repeat test
---

Body`,
    )

    const loadedSkillIds = new Set<string>()
    const context = makeContext(projectPath, { loadedSkillIds })

    const first = await loadSkillForRun(context, 'repeatable-skill')
    const second = await loadSkillForRun(context, 'repeatable-skill')

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (second.ok) {
      expect(second.alreadyLoaded).toBe(true)
      expect(second.warning).toContain('already loaded')
    }
    expect(loadedSkillIds.size).toBe(1)
  })
})
