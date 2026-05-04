import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createPiRuntimeServices, getPiModelAvailableThinkingLevels } from '../pi-provider-catalog'

async function createTempProject(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-pi-skills-'))
}

async function writeSkill(projectPath: string, root: string, id: string): Promise<string> {
  const skillDir = path.join(projectPath, root, 'skills', id)
  await fs.mkdir(skillDir, { recursive: true })
  const skillPath = path.join(skillDir, 'SKILL.md')
  await fs.writeFile(
    skillPath,
    `---\nname: ${id}\ndescription: ${id} instructions\n---\n\n# ${id}\n`,
    'utf8',
  )
  return skillPath
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function loadedSkillPaths(projectPath: string): Promise<readonly string[]> {
  return createPiRuntimeServices(projectPath).then((services) =>
    services.resourceLoader.getSkills().skills.map((skill) => skill.filePath),
  )
}

describe('getPiModelAvailableThinkingLevels', () => {
  it('returns off only for non-reasoning models', () => {
    expect(getPiModelAvailableThinkingLevels({ id: 'gpt-4.1-mini', reasoning: false })).toEqual([
      'off',
    ])
  })

  it('returns standard Pi thinking levels for reasoning models without xhigh support', () => {
    expect(getPiModelAvailableThinkingLevels({ id: 'gpt-5', reasoning: true })).toEqual([
      'off',
      'minimal',
      'low',
      'medium',
      'high',
    ])
  })

  it('returns xhigh for Pi-supported model families', () => {
    expect(getPiModelAvailableThinkingLevels({ id: 'gpt-5.4', reasoning: true })).toEqual([
      'off',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
    ])
  })
})

describe('createPiRuntimeServices', () => {
  it('prefers .openwaggle resources over Pi-native project resources on name collisions', async () => {
    const projectPath = await createTempProject()
    const openWaggleSkill = await writeSkill(projectPath, '.openwaggle', 'shared-skill')
    const piSkill = await writeSkill(projectPath, '.pi', 'shared-skill')
    const agentsSkill = await writeSkill(projectPath, '.agents', 'shared-skill')

    const skillPaths = await loadedSkillPaths(projectPath)

    expect(skillPaths).toContain(openWaggleSkill)
    expect(skillPaths).not.toContain(piSkill)
    expect(skillPaths).not.toContain(agentsSkill)
  })

  it('falls back from .openwaggle to .pi, then .agents on skill collisions', async () => {
    const projectPath = await createTempProject()
    const openWaggleSkill = await writeSkill(projectPath, '.openwaggle', 'shared-skill')
    const piSkill = await writeSkill(projectPath, '.pi', 'shared-skill')
    const agentsSkill = await writeSkill(projectPath, '.agents', 'shared-skill')

    expect(await loadedSkillPaths(projectPath)).toContain(openWaggleSkill)

    await fs.rm(path.dirname(openWaggleSkill), { recursive: true, force: true })
    const piFallbackPaths = await loadedSkillPaths(projectPath)
    expect(piFallbackPaths).toContain(piSkill)
    expect(piFallbackPaths).not.toContain(agentsSkill)

    await fs.rm(path.dirname(piSkill), { recursive: true, force: true })
    expect(await loadedSkillPaths(projectPath)).toContain(agentsSkill)
  })

  it('injects ordered project resource roots for every Pi resource kind', async () => {
    const projectPath = await createTempProject()
    await writeJson(path.join(projectPath, '.openwaggle', 'settings.json'), {
      pi: {
        skills: ['skills/custom'],
        extensions: ['extensions/custom'],
        prompts: ['prompts/custom'],
        themes: ['themes/custom'],
      },
    })

    const services = await createPiRuntimeServices(projectPath)
    const projectSettings = services.settingsManager.getProjectSettings()

    expect(projectSettings.skills).toEqual([
      path.join('..', '.openwaggle', 'skills'),
      'skills',
      path.join('..', '.agents', 'skills'),
      'skills/custom',
    ])
    expect(projectSettings.extensions).toEqual([
      path.join('..', '.openwaggle', 'extensions'),
      'extensions',
      path.join('..', '.agents', 'extensions'),
      'extensions/custom',
    ])
    expect(projectSettings.prompts).toEqual([
      path.join('..', '.openwaggle', 'prompts'),
      'prompts',
      path.join('..', '.agents', 'prompts'),
      'prompts/custom',
    ])
    expect(projectSettings.themes).toEqual([
      path.join('..', '.openwaggle', 'themes'),
      'themes',
      path.join('..', '.agents', 'themes'),
      'themes/custom',
    ])
  })

  it('loads .openwaggle/skills together with Pi-native project skills', async () => {
    const projectPath = await createTempProject()
    const openWaggleSkill = await writeSkill(projectPath, '.openwaggle', 'openwaggle-skill')
    const piSkill = await writeSkill(projectPath, '.pi', 'pi-skill')
    const agentsSkill = await writeSkill(projectPath, '.agents', 'agents-skill')

    const skillPaths = await loadedSkillPaths(projectPath)

    expect(skillPaths).toContain(openWaggleSkill)
    expect(skillPaths).toContain(piSkill)
    expect(skillPaths).toContain(agentsSkill)
  })

  it('applies OpenWaggle catalog toggles to .openwaggle and root .agents skills', async () => {
    const projectPath = await createTempProject()
    const openWaggleSkill = await writeSkill(projectPath, '.openwaggle', 'openwaggle-skill')
    const piSkill = await writeSkill(projectPath, '.pi', 'pi-skill')
    const agentsSkill = await writeSkill(projectPath, '.agents', 'agents-skill')

    const services = await createPiRuntimeServices(projectPath, {
      skillToggles: {
        'openwaggle-skill': false,
        'agents-skill': false,
      },
    })
    const skillPaths = services.resourceLoader.getSkills().skills.map((skill) => skill.filePath)

    expect(skillPaths).not.toContain(openWaggleSkill)
    expect(skillPaths).not.toContain(agentsSkill)
    expect(skillPaths).toContain(piSkill)
  })

  it('loads Pi project settings from the nested pi object with .pi fallback', async () => {
    const projectPath = await createTempProject()
    await writeJson(path.join(projectPath, '.pi', 'settings.json'), {
      compaction: { reserveTokens: 111 },
    })
    await writeJson(path.join(projectPath, '.openwaggle', 'settings.json'), {
      preferences: { model: 'openai-codex/gpt-5.5' },
      pi: {
        compaction: { keepRecentTokens: 222 },
      },
    })

    const services = await createPiRuntimeServices(projectPath)

    expect(services.settingsManager.getProjectSettings().compaction).toEqual({
      reserveTokens: 111,
      keepRecentTokens: 222,
    })
  })

  it('persists Pi project settings back under .openwaggle/settings.json pi object', async () => {
    const projectPath = await createTempProject()
    const settingsPath = path.join(projectPath, '.openwaggle', 'settings.json')
    await writeJson(settingsPath, {
      preferences: { model: 'openai-codex/gpt-5.5' },
      pi: {
        compaction: { enabled: false },
      },
    })

    const services = await createPiRuntimeServices(projectPath)
    services.settingsManager.setProjectSkillPaths(['skills/custom'])
    await services.settingsManager.flush()

    const saved = JSON.parse(await fs.readFile(settingsPath, 'utf8'))
    expect(saved).toEqual({
      preferences: { model: 'openai-codex/gpt-5.5' },
      pi: {
        compaction: { enabled: false },
        skills: ['skills/custom'],
      },
    })
  })
})
