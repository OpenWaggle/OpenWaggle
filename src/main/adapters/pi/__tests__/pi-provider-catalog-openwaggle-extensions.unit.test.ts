import { describe, expect, it } from 'vitest'
import { createPiRuntimeServices } from '../pi-provider-catalog'
import { createTempProject, path, writeProviderPackage } from './pi-provider-catalog.test-utils'

describe('createPiRuntimeServices OpenWaggle extension loading', () => {
  it('loads only runtime-enabled OpenWaggle project extension packages when an allowlist is provided', async () => {
    const projectPath = await createTempProject()
    const enabledPackagePath = path.join(
      projectPath,
      '.openwaggle',
      'extensions',
      'enabled-extension',
    )
    await writeProviderPackage(
      projectPath,
      path.join('.openwaggle', 'extensions', 'enabled-extension'),
      'enabled-provider',
    )
    await writeProviderPackage(
      projectPath,
      path.join('.openwaggle', 'extensions', 'disabled-extension'),
      'disabled-provider',
    )

    const services = await createPiRuntimeServices(projectPath, {
      enabledOpenWaggleExtensionPackagePaths: [enabledPackagePath],
      loadMcpAdapter: false,
    })

    expect(services.settingsManager.getProjectSettings().extensions).toEqual([
      path.join('..', '.openwaggle', 'extensions', 'enabled-extension'),
      'extensions',
      path.join('..', '.agents', 'extensions'),
      '!extensions/pi-mcp-adapter',
      '!extensions/pi-mcp-adapter/**',
    ])
    expect(services.modelRegistry.find('enabled-provider', 'offline-model')).not.toBeNull()
    expect(services.modelRegistry.find('disabled-provider', 'offline-model')).toBeUndefined()
  })

  it('loads runtime-enabled global OpenWaggle extension packages by absolute package path', async () => {
    const projectPath = await createTempProject()
    const globalRootPath = await createTempProject()
    const globalPackagePath = path.join(globalRootPath, 'global-extension')
    await writeProviderPackage(globalRootPath, 'global-extension', 'global-provider')

    const services = await createPiRuntimeServices(projectPath, {
      enabledOpenWaggleExtensionPackagePaths: [globalPackagePath],
      loadMcpAdapter: false,
    })

    expect(services.settingsManager.getProjectSettings().extensions).toEqual([
      globalPackagePath,
      'extensions',
      path.join('..', '.agents', 'extensions'),
      '!extensions/pi-mcp-adapter',
      '!extensions/pi-mcp-adapter/**',
    ])
    expect(services.modelRegistry.find('global-provider', 'offline-model')).not.toBeNull()
  })
})
