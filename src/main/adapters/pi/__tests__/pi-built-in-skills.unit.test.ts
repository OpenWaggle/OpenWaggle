import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { USAGE_STATISTICS_BUILT_IN_SKILLS } from '@shared/usage-statistics/built-in-skills'
import { USAGE_STATISTICS_CATALOG_SKILLS } from '@shared/usage-statistics/catalog.generated'
import { afterEach, describe, expect, it } from 'vitest'
import { VISUALIZE_SKILL_NAME } from '../pi-built-in-skills'
import { piSkillCommandIdentifier, piSkillReadIdentifier } from '../pi-usage-statistics'
import { ensurePiVisualizeSkill } from '../pi-visualize-skill'
import visualizeSkillSource from '../visualize-skill/SKILL.md.raw?raw'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  )
})

describe('OpenWaggle built-in skills and Usage statistics', () => {
  it('publishes exactly the skills OpenWaggle installs, under the names Pi loads them by', () => {
    const frontmatterName = /^name:\s*(\S+)\s*$/mu.exec(visualizeSkillSource)?.[1]

    expect(USAGE_STATISTICS_BUILT_IN_SKILLS).toEqual([VISUALIZE_SKILL_NAME])
    expect(frontmatterName).toBe(VISUALIZE_SKILL_NAME)
    expect(USAGE_STATISTICS_CATALOG_SKILLS).toEqual([VISUALIZE_SKILL_NAME])
  })

  it('names the installed visualize skill when an agent reads it or a prompt invokes it', async () => {
    const agentDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-built-in-skill-'))
    temporaryRoots.push(agentDirectory)

    const skillPath = await ensurePiVisualizeSkill(agentDirectory)

    expect(piSkillReadIdentifier(skillPath)).toBe(VISUALIZE_SKILL_NAME)
    expect(piSkillCommandIdentifier(`/skill:${VISUALIZE_SKILL_NAME} draw it`)).toBe(
      VISUALIZE_SKILL_NAME,
    )
  })
})
