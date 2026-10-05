import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createOpenWaggleGlobalPiSettingsManager,
  createOpenWagglePiSettingsManager,
} from '../openwaggle-pi-settings-storage'

const temporaryDirectories: string[] = []
let agentDirectory = ''
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
  const home = await temporaryDirectory('openwaggle-pi-telemetry-home-')
  agentDirectory = path.join(home, '.pi', 'agent')
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

describe('OpenWaggle Pi settings install-telemetry report', () => {
  it('reports install telemetry on in memory without creating any settings file', async () => {
    const projectPath = await temporaryDirectory('openwaggle-pi-telemetry-project-')

    const settingsManager = createOpenWagglePiSettingsManager(projectPath)

    expect(settingsManager.getEnableInstallTelemetry()).toBe(true)
    expect(createOpenWaggleGlobalPiSettingsManager().getEnableInstallTelemetry()).toBe(true)
    expect(existsSync(globalSettingsPath)).toBe(false)
    expect(existsSync(path.join(projectPath, '.pi', 'settings.json'))).toBe(false)
    expect(existsSync(path.join(projectPath, '.openwaggle', 'settings.json'))).toBe(false)
  })

  it("overrides the user's stored Pi choice in memory and never writes over it", async () => {
    const projectPath = await temporaryDirectory('openwaggle-pi-telemetry-project-')
    await writeJson(globalSettingsPath, { enableInstallTelemetry: false, theme: 'dark' })

    const settingsManager = createOpenWagglePiSettingsManager(projectPath)
    settingsManager.setDefaultModelAndProvider('openai', 'gpt-5.2')
    await settingsManager.flush()

    expect(settingsManager.getEnableInstallTelemetry()).toBe(true)
    expect(settingsManager.drainErrors()).toEqual([])
    expect(await readJson(globalSettingsPath)).toEqual({
      enableInstallTelemetry: false,
      theme: 'dark',
      defaultProvider: 'openai',
      defaultModel: 'gpt-5.2',
    })
  })

  it('never adds the setting to global Pi settings that did not have it', async () => {
    const projectPath = await temporaryDirectory('openwaggle-pi-telemetry-project-')

    const settingsManager = createOpenWagglePiSettingsManager(projectPath)
    settingsManager.setDefaultModelAndProvider('anthropic', 'claude-opus-5')
    await settingsManager.flush()

    expect(await readJson(globalSettingsPath)).toEqual({
      defaultProvider: 'anthropic',
      defaultModel: 'claude-opus-5',
    })
  })

  it('never writes the reported value into project settings', async () => {
    const projectPath = await temporaryDirectory('openwaggle-pi-telemetry-project-')
    const openWaggleSettingsPath = path.join(projectPath, '.openwaggle', 'settings.json')
    await writeJson(openWaggleSettingsPath, { pi: { compaction: { enabled: false } } })

    const settingsManager = createOpenWagglePiSettingsManager(projectPath)
    settingsManager.setProjectSkillPaths(['skills/custom'])
    await settingsManager.flush()

    expect(settingsManager.getEnableInstallTelemetry()).toBe(true)
    expect(await readJson(openWaggleSettingsPath)).toEqual({
      pi: { compaction: { enabled: false }, skills: ['skills/custom'] },
    })
    expect(existsSync(globalSettingsPath)).toBe(false)
  })

  it("keeps a project's own stored choice and still reports install telemetry on", async () => {
    const projectPath = await temporaryDirectory('openwaggle-pi-telemetry-project-')
    const openWaggleSettingsPath = path.join(projectPath, '.openwaggle', 'settings.json')
    await writeJson(openWaggleSettingsPath, { pi: { enableInstallTelemetry: false } })

    const settingsManager = createOpenWagglePiSettingsManager(projectPath)
    settingsManager.setProjectSkillPaths(['skills/custom'])
    await settingsManager.flush()

    expect(settingsManager.getEnableInstallTelemetry()).toBe(true)
    expect(await readJson(openWaggleSettingsPath)).toEqual({
      pi: { enableInstallTelemetry: false, skills: ['skills/custom'] },
    })
  })

  it("keeps the user's stored key where it was in the file", async () => {
    const projectPath = await temporaryDirectory('openwaggle-pi-telemetry-project-')
    await writeJson(globalSettingsPath, {
      theme: 'dark',
      enableInstallTelemetry: false,
      quietStartup: true,
    })

    const settingsManager = createOpenWagglePiSettingsManager(projectPath)
    settingsManager.setDefaultModelAndProvider('openai', 'gpt-5.2')
    await settingsManager.flush()

    const written = await readJson(globalSettingsPath)
    expect(typeof written === 'object' && written !== null ? Object.keys(written) : []).toEqual([
      'theme',
      'enableInstallTelemetry',
      'quietStartup',
      'defaultProvider',
      'defaultModel',
    ])
    expect(written).toMatchObject({ enableInstallTelemetry: false })
  })
})
