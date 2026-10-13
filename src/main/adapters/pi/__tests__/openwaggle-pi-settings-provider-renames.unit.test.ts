import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createOpenWaggleGlobalPiSettingsManager,
  createOpenWagglePiSettingsManager,
} from '../openwaggle-pi-settings-storage'

const temporaryDirectories: string[] = []
let globalSettingsPath = ''

async function temporaryDirectory(prefix: string) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

async function writeJson(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

beforeEach(async () => {
  const home = await temporaryDirectory('openwaggle-pi-rename-home-')
  const agentDirectory = path.join(home, '.pi', 'agent')
  globalSettingsPath = path.join(agentDirectory, 'settings.json')
  vi.stubEnv('HOME', home)
  vi.stubEnv('PI_CODING_AGENT_DIR', agentDirectory)
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  )
})

describe('OpenWaggle Pi settings provider renames', () => {
  it('reads global Pi settings that name the old Azure provider under its new id', async () => {
    await writeJson(globalSettingsPath, {
      defaultProvider: 'azure-openai-responses',
      defaultModel: 'gpt-5.4',
      enabledModels: ['azure-openai-responses/*'],
      modelThinkingLevels: { 'azure-openai-responses/gpt-5.4': 'high' },
    })

    const settings = createOpenWaggleGlobalPiSettingsManager()

    expect(settings.getDefaultProvider()).toBe('azure')
    expect(settings.getEnabledModels()).toEqual(['azure/*'])
    expect(settings.getModelThinkingLevel('azure', 'gpt-5.4')).toBe('high')
  })

  it('reads OpenWaggle project Pi settings under the new id too', async () => {
    const projectPath = await temporaryDirectory('openwaggle-pi-rename-project-')
    await writeJson(path.join(projectPath, '.openwaggle', 'settings.json'), {
      pi: { defaultProvider: 'azure-openai-responses', defaultModel: 'gpt-5.5' },
    })

    expect(createOpenWagglePiSettingsManager(projectPath).getDefaultProvider()).toBe('azure')
  })

  it('stores the new id the next time OpenWaggle writes global Pi settings', async () => {
    const projectPath = await temporaryDirectory('openwaggle-pi-rename-project-')
    await writeJson(globalSettingsPath, {
      defaultProvider: 'azure-openai-responses',
      defaultModel: 'gpt-5.4',
      theme: 'dark',
    })

    const settings = createOpenWagglePiSettingsManager(projectPath)
    settings.setTheme('light')
    await settings.flush()

    expect(settings.drainErrors()).toEqual([])
    expect(await readJson(globalSettingsPath)).toEqual({
      defaultProvider: 'azure',
      defaultModel: 'gpt-5.4',
      theme: 'light',
    })
  })
})
