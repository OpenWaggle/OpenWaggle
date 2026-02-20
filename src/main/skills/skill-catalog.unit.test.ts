import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  loadSkillCatalog,
  loadSkillInstructions,
  normalizeRequestedSkillId,
  toSkillCatalogResult,
} from './skill-catalog'

const tempDirs: string[] = []

async function makeTempProject(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'openhive-skill-catalog-'))
  tempDirs.push(dir)
  return dir
}

async function writeSkill(
  projectPath: string,
  folder: string,
  content: string,
  withScripts = false,
): Promise<void> {
  const skillDir = path.join(projectPath, '.openhive', 'skills', folder)
  await fs.mkdir(skillDir, { recursive: true })
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), content, 'utf8')
  if (withScripts) {
    await fs.mkdir(path.join(skillDir, 'scripts'), { recursive: true })
    await fs.writeFile(path.join(skillDir, 'scripts', 'run.sh'), '#!/usr/bin/env bash', 'utf8')
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('loadSkillCatalog', () => {
  it('loads valid skills and marks script availability', async () => {
    const projectPath = await makeTempProject()
    await writeSkill(
      projectPath,
      'code-review',
      `---
name: code-review
description: Review code changes.
---

# Code Review`,
      true,
    )

    const catalog = await loadSkillCatalog(projectPath)

    expect(catalog.skills).toHaveLength(1)
    expect(catalog.skills[0]).toMatchObject({
      id: 'code-review',
      name: 'code-review',
      description: 'Review code changes.',
      enabled: true,
      loadStatus: 'ok',
      hasScripts: true,
    })
  })

  it('marks malformed skills as non-blocking errors', async () => {
    const projectPath = await makeTempProject()
    await writeSkill(projectPath, 'broken-skill', '# missing frontmatter')

    const catalog = await loadSkillCatalog(projectPath)
    const skill = catalog.skills[0]

    expect(skill?.id).toBe('broken-skill')
    expect(skill?.loadStatus).toBe('error')
    expect(skill?.loadError).toContain('missing YAML frontmatter')
  })

  it('parses frontmatter with CRLF newlines', async () => {
    const projectPath = await makeTempProject()
    await writeSkill(
      projectPath,
      'windows-skill',
      '---\r\nname: windows-skill\r\ndescription: Works on CRLF\r\n---\r\n\r\nBody\r\n',
    )

    const catalog = await loadSkillCatalog(projectPath)
    const skill = catalog.skills[0]

    expect(skill?.loadStatus).toBe('ok')
    expect(skill?.description).toBe('Works on CRLF')
  })

  it('applies project toggles by skill id', async () => {
    const projectPath = await makeTempProject()
    await writeSkill(
      projectPath,
      'frontend-design',
      `---
name: frontend-design
description: Build polished interfaces.
---

Do things.`,
    )

    const catalog = await loadSkillCatalog(projectPath, { 'frontend-design': false })
    expect(catalog.skills[0]?.enabled).toBe(false)
  })

  it('strips internal body when converting to IPC-safe catalog result', async () => {
    const projectPath = await makeTempProject()
    await writeSkill(
      projectPath,
      'skill-a',
      `---
name: skill-a
description: desc
---

Body text`,
    )

    const loaded = await loadSkillCatalog(projectPath)
    const result = toSkillCatalogResult(loaded)

    expect(result.skills).toHaveLength(1)
    expect(result.skills[0]).not.toHaveProperty('body')
  })

  it('loads full skill instructions by id', async () => {
    const projectPath = await makeTempProject()
    await writeSkill(
      projectPath,
      'skill-loader',
      `---
name: skill-loader
description: desc
---

Step 1
Step 2`,
    )

    const loaded = await loadSkillInstructions(projectPath, 'skill-loader')

    expect(loaded.id).toBe('skill-loader')
    expect(loaded.instructions).toContain('Step 1')
    expect(loaded.loadStatus).toBe('ok')
  })

  it('rejects invalid requested skill ids', () => {
    expect(() => normalizeRequestedSkillId('../skill')).toThrow(/invalid skill id/i)
  })
})
