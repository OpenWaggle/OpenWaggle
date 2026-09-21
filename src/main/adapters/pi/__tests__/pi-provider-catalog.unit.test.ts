import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPiRuntimeServices, findPiToolCapableModel } from '../pi-provider-catalog'
import {
  createTempProject,
  fs,
  loadedSkillPaths,
  path,
  writeJson,
  writeProviderExtension,
  writeSkill,
} from './pi-provider-catalog.test-utils'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('createPiRuntimeServices', () => {
  it('loads the built-in Visualize skill and binds the current session directory', async () => {
    const projectPath = await createTempProject()
    const visualizationDirectory = path.join(projectPath, '.session-visualizations')

    const services = await createPiRuntimeServices(projectPath, { visualizationDirectory })
    const visualizeSkill = services.resourceLoader
      .getSkills()
      .skills.find((skill) => skill.name === 'visualize')

    expect(visualizeSkill?.filePath).toMatch(
      /openwaggle-built-in-skills[/\\]visualize[/\\]SKILL\.md$/,
    )
    await expect(
      fs.stat(path.join(path.dirname(visualizeSkill?.filePath ?? ''), 'scripts', 'render.py')),
    ).resolves.toMatchObject({ mode: expect.any(Number) })
    expect(services.resourceLoader.getAppendSystemPrompt()).toEqual([
      expect.stringContaining(JSON.stringify(visualizationDirectory)),
    ])
  })

  it('uses Pi ModelRuntime membership as the tool-capable model contract', async () => {
    const projectPath = await createTempProject()
    const providerId = 'contract-provider'
    await writeProviderExtension(projectPath, providerId)
    const services = await createPiRuntimeServices(projectPath)
    const runtimeModel = services.modelRuntime.getModel(providerId, 'offline-model')

    expect(
      findPiToolCapableModel(services.modelRuntime, `${providerId}/offline-model`),
    ).toStrictEqual(runtimeModel)
    expect(findPiToolCapableModel(services.modelRuntime, `${providerId}/missing-model`)).toBeNull()
  })

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
      'extensions',
      path.join('..', '.agents', 'extensions'),
      'extensions/custom',
      '!extensions/pi-mcp-adapter',
      '!extensions/pi-mcp-adapter/**',
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

  it('applies an explicit project toggle to a same-named global Pi skill', async () => {
    const projectPath = await createTempProject()
    const agentDir = path.join(projectPath, 'pi-agent')
    vi.stubEnv('PI_CODING_AGENT_DIR', agentDir)
    const globalSkill = await writeSkill(agentDir, '.', 'herdr-orchestration')

    const enabledServices = await createPiRuntimeServices(projectPath)
    expect(
      enabledServices.resourceLoader.getSkills().skills.map((skill) => skill.filePath),
    ).toContain(globalSkill)

    const disabledServices = await createPiRuntimeServices(projectPath, {
      skillToggles: { 'herdr-orchestration': false },
    })
    expect(
      disabledServices.resourceLoader.getSkills().skills.map((skill) => skill.filePath),
    ).not.toContain(globalSkill)
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

  it('loads inline extensions without mutating the process cwd or argv', async () => {
    const projectPath = await createTempProject()
    const observed: {
      cwd?: string
      argv?: readonly string[]
    } = {}
    const factory: ExtensionFactory = (pi) => {
      observed.cwd = process.cwd()
      observed.argv = [...process.argv]
      pi.registerCommand('inline-extension-test', { handler: async () => undefined })
    }
    const expectedCwd = process.cwd()
    const expectedArgv = [...process.argv]

    await createPiRuntimeServices(projectPath, {
      extensionFactories: [factory],
    })

    expect(observed.cwd).toBe(expectedCwd)
    expect(observed.argv).toEqual(expectedArgv)
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
