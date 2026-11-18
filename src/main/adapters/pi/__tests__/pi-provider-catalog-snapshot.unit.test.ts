import { createAgentSessionServices } from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LEGACY_PI_MCP_ADAPTER_PACKAGE_SOURCES } from '../../../migrations/legacy-pi-mcp-adapter'
import {
  createPiProviderCatalogSnapshot,
  createPiRuntimeServices,
  resolvePiVisualizeSkillPaths,
} from '../pi-provider-catalog'
import {
  createTempProject,
  fs,
  path,
  writeJson,
  writeNpmProviderPackage,
  writeProviderExtension,
  writeProviderPackage,
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
