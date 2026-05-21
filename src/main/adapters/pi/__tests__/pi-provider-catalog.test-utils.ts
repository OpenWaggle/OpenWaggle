import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createPiRuntimeServices } from '../pi-provider-catalog'

export { existsSync, fs, path }

export async function createTempProject() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-pi-skills-'))
}

export async function writeSkill(projectPath: string, root: string, id: string) {
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

export async function writeJson(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function providerExtensionModule(providerId: string) {
  return `export default function extension(pi) {
  pi.registerProvider('${providerId}', {
    baseUrl: 'https://example.test/v1',
    apiKey: 'OPENWAGGLE_TEST_PROVIDER_API_KEY',
    api: 'openai-completions',
    models: [
      {
        id: 'offline-model',
        name: 'Offline Model',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096,
      },
    ],
  })
}
`
}

export async function writeProviderExtension(projectPath: string, providerId: string) {
  const extensionPath = path.join(projectPath, '.pi', 'extensions', `${providerId}.js`)
  await fs.mkdir(path.dirname(extensionPath), { recursive: true })
  await fs.writeFile(extensionPath, providerExtensionModule(providerId), 'utf8')
  return extensionPath
}

export async function writeProviderPackage(
  baseDir: string,
  packageSource: string,
  providerId: string,
) {
  const packageDir = path.join(baseDir, packageSource)
  await writeJson(path.join(packageDir, 'package.json'), {
    pi: {
      extensions: ['extensions/provider.js'],
    },
  })
  await fs.mkdir(path.join(packageDir, 'extensions'), { recursive: true })
  await fs.writeFile(
    path.join(packageDir, 'extensions', 'provider.js'),
    providerExtensionModule(providerId),
    'utf8',
  )
}

export function loadedSkillPaths(projectPath: string) {
  return createPiRuntimeServices(projectPath).then((services) =>
    services.resourceLoader.getSkills().skills.map((skill) => skill.filePath),
  )
}
