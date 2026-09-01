import { createAgentSessionServices, type ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LEGACY_PI_MCP_ADAPTER_PACKAGE_SOURCES } from '../../../migrations/legacy-pi-mcp-adapter'
import {
  createPiProviderCatalogSnapshot,
  createPiRuntimeServices,
  findPiToolCapableModel,
  resolvePiVisualizeSkillPaths,
} from '../pi-provider-catalog'
import {
  createTempProject,
  fs,
  loadedSkillPaths,
  path,
  writeJson,
  writeNpmProviderPackage,
  writeProviderExtension,
  writeProviderPackage,
  writeSkill,
} from './pi-provider-catalog.test-utils'

const LEGACY_MCP_PACKAGE_SOURCE = LEGACY_PI_MCP_ADAPTER_PACKAGE_SOURCES[0]

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('createPiProviderCatalogSnapshot', () => {
  it('keeps Pi services available when built-in Visualize installation fails', async () => {
    const install = vi.fn(async () => {
      throw new Error('read-only agent directory')
    })

    await expect(resolvePiVisualizeSkillPaths('/read-only/pi-agent', install)).resolves.toEqual([])
  })

  it('does not load a user-managed MCP adapter or remove it from other Pi projects', async () => {
    const root = await createTempProject()
    const agentDir = path.join(root, 'pi-agent')
    const home = path.join(root, 'home')
    const packageName = 'pi-mcp-adapter'
    const packageVersion = '2.5.4'
    const packageSource = `npm:${packageName}@${packageVersion}`
    const mcpProviderId = 'user-managed-mcp-adapter-provider'
    const otherProviderId = 'other-user-package-provider'
    vi.stubEnv('HOME', home)
    vi.stubEnv('PI_CODING_AGENT_DIR', agentDir)
    await writeNpmProviderPackage(agentDir, packageName, packageVersion, mcpProviderId)
    await writeProviderPackage(agentDir, 'extensions/global-provider-package', otherProviderId)
    await writeJson(path.join(agentDir, 'settings.json'), {
      packages: [packageSource, 'extensions/global-provider-package'],
    })
    const settingsBeforeOpenWaggle = await fs.readFile(path.join(agentDir, 'settings.json'), 'utf8')

    try {
      const snapshot = await createPiProviderCatalogSnapshot(null)

      expect(snapshot.providers.map((provider) => provider.provider)).not.toContain(mcpProviderId)
      expect(snapshot.providers.map((provider) => provider.provider)).toContain(otherProviderId)
      expect(await fs.readFile(path.join(agentDir, 'settings.json'), 'utf8')).toBe(
        settingsBeforeOpenWaggle,
      )

      const openWaggleServices = await createPiRuntimeServices(root)
      openWaggleServices.settingsManager.setTheme('light')
      await openWaggleServices.settingsManager.flush()
      const settingsAfterOpenWaggleWrite = JSON.parse(
        await fs.readFile(path.join(agentDir, 'settings.json'), 'utf8'),
      )
      expect(settingsAfterOpenWaggleWrite).toEqual({
        packages: [packageSource, 'extensions/global-provider-package'],
        theme: 'light',
      })

      const externalPiServices = await createAgentSessionServices({
        cwd: root,
        agentDir,
      })
      expect(externalPiServices.modelRuntime.getProvider(mcpProviderId)?.id).toBe(mcpProviderId)
      expect(externalPiServices.modelRuntime.getProvider(otherProviderId)?.id).toBe(otherProviderId)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('removes and does not load an OpenWaggle-owned legacy global MCP package entry', async () => {
    const root = await createTempProject()
    const agentDir = path.join(root, 'pi-agent')
    const home = path.join(root, 'home')
    const providerId = 'global-offline-provider'
    const mcpProviderId = 'mcp-adapter-leak-provider'
    vi.stubEnv('HOME', home)
    vi.stubEnv('PI_CODING_AGENT_DIR', agentDir)
    await writeProviderPackage(agentDir, 'extensions/global-provider-package', providerId)
    await writeProviderPackage(agentDir, LEGACY_MCP_PACKAGE_SOURCE, mcpProviderId)
    await writeJson(path.join(agentDir, 'settings.json'), {
      packages: ['extensions/global-provider-package', LEGACY_MCP_PACKAGE_SOURCE],
    })

    try {
      const snapshot = await createPiProviderCatalogSnapshot(null)

      expect(snapshot.providers.map((provider) => provider.provider)).toContain(providerId)
      expect(snapshot.providers.map((provider) => provider.provider)).not.toContain(mcpProviderId)
      const saved = JSON.parse(await fs.readFile(path.join(agentDir, 'settings.json'), 'utf8'))
      expect(saved.packages).toEqual(['extensions/global-provider-package'])
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('removes and does not load an OpenWaggle-owned legacy project MCP package entry', async () => {
    const projectPath = await createTempProject()
    const providerId = 'offline-provider'
    const mcpProviderId = 'project-mcp-adapter-leak-provider'
    await writeProviderExtension(projectPath, providerId)
    await writeProviderPackage(
      path.join(projectPath, '.pi'),
      LEGACY_MCP_PACKAGE_SOURCE,
      mcpProviderId,
    )
    await writeJson(path.join(projectPath, '.pi', 'settings.json'), {
      packages: [LEGACY_MCP_PACKAGE_SOURCE],
    })

    const snapshot = await createPiProviderCatalogSnapshot(projectPath)
    const provider = snapshot.providers.find((candidate) => candidate.provider === providerId)

    expect(provider?.models.map((model) => model.ref)).toContain(`${providerId}/offline-model`)
    expect(snapshot.providers.map((candidate) => candidate.provider)).not.toContain(mcpProviderId)
    const saved = JSON.parse(
      await fs.readFile(path.join(projectPath, '.pi', 'settings.json'), 'utf8'),
    )
    expect(saved.packages).toBeUndefined()
  })
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

  it('uses the OpenWaggle global compaction threshold instead of a project override', async () => {
    const projectPath = await createTempProject()
    await writeJson(path.join(projectPath, '.openwaggle', 'settings.json'), {
      pi: {
        compaction: { thresholdPercent: 95 },
      },
    })

    const services = await createPiRuntimeServices(projectPath, {
      compactionThresholdPercent: 72,
    })

    expect(services.settingsManager.getCompactionSettings().thresholdPercent).toBe(72)
  })

  it('publishes Native compaction only for explicitly capable built-in model transports', async () => {
    const projectPath = await createTempProject()
    const services = await createPiRuntimeServices(projectPath)

    expect(services.modelRuntime.getModel('openai', 'gpt-5.2')?.compat).toMatchObject({
      supportsCompaction: true,
    })
    expect(services.modelRuntime.getModel('openai', 'gpt-5.1')?.compat).not.toEqual(
      expect.objectContaining({ supportsCompaction: true }),
    )
    expect(services.modelRuntime.getModel('openai-codex', 'gpt-5.6-sol')?.compat).toMatchObject({
      supportsCompaction: true,
      compactionBaseUrl: 'https://chatgpt.com/backend-api/codex',
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
