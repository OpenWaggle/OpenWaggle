import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ensureProjectSettingsFile,
  loadProjectConfig,
  setProjectPreferences,
} from '../project-config'

function settingsPath(projectPath: string): string {
  return join(projectPath, '.openwaggle', 'settings.json')
}

describe('project config integration', () => {
  let tmpRoot: string

  beforeEach(() => {
    tmpRoot = join(tmpdir(), `openwaggle-project-config-integration-${Date.now()}`)
    mkdirSync(tmpRoot, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('creates project settings JSON in the OpenWaggle project directory', async () => {
    const projectPath = join(tmpRoot, 'project')

    await ensureProjectSettingsFile(projectPath)

    expect(readFileSync(settingsPath(projectPath), 'utf-8')).toBe('{}\n')
  })

  it('loads preferences and nested Pi settings from one settings file', async () => {
    const projectPath = join(tmpRoot, 'project-merged')
    mkdirSync(join(projectPath, '.openwaggle'), { recursive: true })
    writeFileSync(
      settingsPath(projectPath),
      JSON.stringify({
        pi: {
          compaction: { enabled: false },
        },
      }),
      'utf-8',
    )

    await setProjectPreferences(projectPath, { model: 'openai/gpt-4.1' })

    const config = await loadProjectConfig(projectPath)
    expect(config.preferences).toEqual({ model: 'openai/gpt-4.1' })
    expect(config.pi).toEqual({ compaction: { enabled: false } })
  })
})
