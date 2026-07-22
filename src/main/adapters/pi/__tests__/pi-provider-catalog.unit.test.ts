import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { MCP_ADAPTER_PACKAGE_SOURCE } from '@shared/constants/mcp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createPiProviderCatalogSnapshot,
  createPiRuntimeServices,
  getPiModelAvailableThinkingLevels,
} from '../pi-provider-catalog'
import {
  createTempProject,
  existsSync,
  fs,
  loadedSkillPaths,
  path,
  writeJson,
  writeProviderExtension,
  writeProviderPackage,
  writeSkill,
} from './pi-provider-catalog.test-utils'

afterEach(() => {
  vi.unstubAllEnvs()
})

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

describe('createPiProviderCatalogSnapshot', () => {
  it('loads global provider catalog without loading configured OpenWaggle MCP packages', async () => {
    const root = await createTempProject()
    const agentDir = path.join(root, 'pi-agent')
    const home = path.join(root, 'home')
    const providerId = 'global-offline-provider'
    const mcpProviderId = 'mcp-adapter-leak-provider'
    vi.stubEnv('HOME', home)
    vi.stubEnv('PI_CODING_AGENT_DIR', agentDir)
    await writeProviderPackage(agentDir, 'extensions/global-provider-package', providerId)
    await writeProviderPackage(agentDir, MCP_ADAPTER_PACKAGE_SOURCE, mcpProviderId)
    await writeJson(path.join(agentDir, 'settings.json'), {
      packages: ['extensions/global-provider-package', MCP_ADAPTER_PACKAGE_SOURCE],
    })

    try {
      const snapshot = await createPiProviderCatalogSnapshot(null)

      expect(snapshot.providers.map((provider) => provider.provider)).toContain(providerId)
      expect(snapshot.providers.map((provider) => provider.provider)).not.toContain(mcpProviderId)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('loads project provider catalog without loading configured OpenWaggle MCP packages', async () => {
    const projectPath = await createTempProject()
    const providerId = 'offline-provider'
    const mcpProviderId = 'project-mcp-adapter-leak-provider'
    await writeProviderExtension(projectPath, providerId)
    await writeProviderPackage(
      path.join(projectPath, '.pi'),
      MCP_ADAPTER_PACKAGE_SOURCE,
      mcpProviderId,
    )
    await writeJson(path.join(projectPath, '.pi', 'settings.json'), {
      packages: [MCP_ADAPTER_PACKAGE_SOURCE],
    })

    const snapshot = await createPiProviderCatalogSnapshot(projectPath)
    const provider = snapshot.providers.find((candidate) => candidate.provider === providerId)

    expect(provider?.models.map((model) => model.ref)).toContain(`${providerId}/offline-model`)
    expect(snapshot.providers.map((candidate) => candidate.provider)).not.toContain(mcpProviderId)
    expect(existsSync(path.join(projectPath, '.pi', 'npm', 'node_modules', 'pi-mcp-adapter'))).toBe(
      false,
    )
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

  it('loads extensions with the generated MCP adapter config path and isolated adapter cwd', async () => {
    const projectPath = await createTempProject()
    const adapterCwd = path.join(projectPath, 'generated-adapter-cwd')
    const configPath = path.join(projectPath, 'generated-mcp.json')
    await fs.mkdir(adapterCwd, { recursive: true })
    await writeJson(configPath, { mcpServers: {} })

    const observed: {
      cwd?: string
      argv?: readonly string[]
    } = {}
    const factory: ExtensionFactory = (pi) => {
      observed.cwd = process.cwd()
      observed.argv = [...process.argv]
      pi.registerFlag('mcp-config', {
        description: 'Path to MCP config file',
        type: 'string',
      })
    }

    const services = await createPiRuntimeServices(projectPath, {
      extensionFactories: [factory],
      mcpRuntimeContext: { configPath, adapterCwd },
    })

    expect(observed.cwd).toBe(adapterCwd)
    expect(observed.argv?.slice(-2)).toEqual(['--mcp-config', configPath])
    expect(services.resourceLoader.getExtensions().runtime.flagValues.get('mcp-config')).toBe(
      configPath,
    )
  })

  it('can load provider metadata services without the MCP adapter runtime context', async () => {
    const projectPath = await createTempProject()
    const adapterCwd = path.join(projectPath, 'generated-adapter-cwd')
    const configPath = path.join(projectPath, 'generated-mcp.json')
    await fs.mkdir(adapterCwd, { recursive: true })
    await writeJson(configPath, { mcpServers: {} })

    const observed: {
      cwd?: string
      argv?: readonly string[]
    } = {}
    const factory: ExtensionFactory = (pi) => {
      observed.cwd = process.cwd()
      observed.argv = [...process.argv]
      pi.registerFlag('mcp-config', {
        description: 'Path to MCP config file',
        type: 'string',
      })
    }

    const services = await createPiRuntimeServices(projectPath, {
      extensionFactories: [factory],
      loadMcpAdapter: false,
      mcpRuntimeContext: { configPath, adapterCwd },
    })

    expect(observed.cwd).not.toBe(adapterCwd)
    expect(observed.argv?.slice(-2)).not.toEqual(['--mcp-config', configPath])
    expect(services.resourceLoader.getExtensions().runtime.flagValues.get('mcp-config')).toBe(
      undefined,
    )
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
