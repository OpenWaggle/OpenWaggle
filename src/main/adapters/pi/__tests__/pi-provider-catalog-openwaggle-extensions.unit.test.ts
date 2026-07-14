import { describe, expect, it } from 'vitest'
import { createPiRuntimeServices } from '../pi-provider-catalog'
import {
  createTempProject,
  fs,
  path,
  writeJson,
  writeProviderPackage,
  writeSkill,
} from './pi-provider-catalog.test-utils'

async function writePrompt(packageDir: string, id: string) {
  const promptPath = path.join(packageDir, 'prompts', `${id}.md`)
  await fs.mkdir(path.dirname(promptPath), { recursive: true })
  await fs.writeFile(
    promptPath,
    `---\ndescription: ${id} prompt\n---\n\nRun ${id} prompt.\n`,
    'utf8',
  )
  return promptPath
}

async function writeProviderResourcePackage(input: {
  readonly baseDir: string
  readonly packageSource: string
  readonly providerId: string
  readonly skillId: string
  readonly promptId: string
}) {
  await writeProviderPackage(input.baseDir, input.packageSource, input.providerId)
  const packageDir = path.join(input.baseDir, input.packageSource)
  await writeJson(path.join(packageDir, 'package.json'), {
    pi: {
      extensions: ['extensions/provider.js'],
      skills: ['skills'],
      prompts: ['prompts'],
    },
  })
  const skillPath = await writeSkill(packageDir, '.', input.skillId)
  const promptPath = await writePrompt(packageDir, input.promptId)
  return { packageDir, skillPath, promptPath }
}

describe('createPiRuntimeServices OpenWaggle extension loading', () => {
  it('loads only runtime-enabled OpenWaggle project extension packages as Pi packages when an allowlist is provided', async () => {
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
      'extensions',
      path.join('..', '.agents', 'extensions'),
      '!extensions/pi-mcp-adapter',
      '!extensions/pi-mcp-adapter/**',
    ])
    expect(services.settingsManager.getProjectSettings().packages).toEqual([
      path.join('..', '.openwaggle', 'extensions', 'enabled-extension'),
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
      'extensions',
      path.join('..', '.agents', 'extensions'),
      '!extensions/pi-mcp-adapter',
      '!extensions/pi-mcp-adapter/**',
    ])
    expect(services.settingsManager.getProjectSettings().packages).toEqual([globalPackagePath])
    expect(services.modelRegistry.find('global-provider', 'offline-model')).not.toBeNull()
  })

  it('loads Pi package-declared runtime resources from enabled OpenWaggle extension packages', async () => {
    const projectPath = await createTempProject()
    const packageSource = path.join('.openwaggle', 'extensions', 'resource-extension')
    const { packageDir, skillPath, promptPath } = await writeProviderResourcePackage({
      baseDir: projectPath,
      packageSource,
      providerId: 'resource-provider',
      skillId: 'resource-skill',
      promptId: 'resource-prompt',
    })

    const services = await createPiRuntimeServices(projectPath, {
      enabledOpenWaggleExtensionPackagePaths: [packageDir],
      loadMcpAdapter: false,
    })

    expect(services.modelRegistry.find('resource-provider', 'offline-model')).not.toBeNull()
    expect(services.resourceLoader.getSkills().skills.map((skill) => skill.filePath)).toContain(
      skillPath,
    )
    expect(services.resourceLoader.getPrompts().prompts.map((prompt) => prompt.filePath)).toContain(
      promptPath,
    )
  })

  it('loads manifest-declared Pi resource roots from enabled OpenWaggle extension packages', async () => {
    const projectPath = await createTempProject()
    const packageDir = path.join(
      projectPath,
      '.openwaggle',
      'extensions',
      'manifest-resource-extension',
    )
    await writeProviderPackage(packageDir, 'pi', 'manifest-resource-provider')
    const skillPath = await writeSkill(packageDir, 'pi', 'manifest-resource-skill')
    const promptPath = await writePrompt(path.join(packageDir, 'pi'), 'manifest-resource-prompt')

    const services = await createPiRuntimeServices(projectPath, {
      enabledOpenWaggleExtensionPackagePaths: [],
      enabledOpenWaggleExtensionResourceRoots: [{ packagePath: packageDir, resourceRoot: 'pi' }],
      loadMcpAdapter: false,
    })

    expect(services.settingsManager.getProjectSettings().skills).toEqual([
      path.join('..', '.openwaggle', 'skills'),
      path.join('..', '.openwaggle', 'extensions', 'manifest-resource-extension', 'pi', 'skills'),
      'skills',
      path.join('..', '.agents', 'skills'),
    ])
    expect(services.settingsManager.getProjectSettings().extensions).toEqual([
      path.join(
        '..',
        '.openwaggle',
        'extensions',
        'manifest-resource-extension',
        'pi',
        'extensions',
      ),
      'extensions',
      path.join('..', '.agents', 'extensions'),
      '!extensions/pi-mcp-adapter',
      '!extensions/pi-mcp-adapter/**',
    ])
    expect(
      services.modelRegistry.find('manifest-resource-provider', 'offline-model'),
    ).not.toBeNull()
    expect(services.resourceLoader.getSkills().skills.map((skill) => skill.filePath)).toContain(
      skillPath,
    )
    expect(services.resourceLoader.getPrompts().prompts.map((prompt) => prompt.filePath)).toContain(
      promptPath,
    )
  })

  it('strips implicit runtime package sources when Pi persists project settings', async () => {
    const projectPath = await createTempProject()
    const packageSource = path.join('.openwaggle', 'extensions', 'persisted-extension')
    const { packageDir } = await writeProviderResourcePackage({
      baseDir: projectPath,
      packageSource,
      providerId: 'persisted-provider',
      skillId: 'persisted-skill',
      promptId: 'persisted-prompt',
    })
    const settingsPath = path.join(projectPath, '.openwaggle', 'settings.json')

    const services = await createPiRuntimeServices(projectPath, {
      enabledOpenWaggleExtensionPackagePaths: [packageDir],
    })
    services.settingsManager.setProjectSkillPaths(['skills/custom'])
    await services.settingsManager.flush()

    const saved = JSON.parse(await fs.readFile(settingsPath, 'utf8'))

    expect(saved.pi).toEqual({
      skills: ['skills/custom'],
    })
  })

  it('strips implicit manifest resource roots when Pi persists project settings', async () => {
    const projectPath = await createTempProject()
    const packageDir = path.join(
      projectPath,
      '.openwaggle',
      'extensions',
      'persisted-resource-root-extension',
    )
    await writeProviderPackage(packageDir, 'pi', 'persisted-resource-root-provider')
    const settingsPath = path.join(projectPath, '.openwaggle', 'settings.json')

    const services = await createPiRuntimeServices(projectPath, {
      enabledOpenWaggleExtensionPackagePaths: [],
      enabledOpenWaggleExtensionResourceRoots: [{ packagePath: packageDir, resourceRoot: 'pi' }],
    })
    services.settingsManager.setProjectPromptTemplatePaths(['prompts/custom'])
    await services.settingsManager.flush()

    const saved = JSON.parse(await fs.readFile(settingsPath, 'utf8'))

    expect(saved.pi).toEqual({
      prompts: ['prompts/custom'],
    })
  })
})
