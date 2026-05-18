import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clearConfigCache,
  ensureProjectSettingsFile,
  getProjectSettingsPath,
  loadProjectConfig,
  setProjectPreferences,
  updateProjectConfig,
} from '../project-config'

function getSettingsPath(projectPath: string): string {
  return join(projectPath, '.openwaggle', 'settings.json')
}

describe('loadProjectConfig', () => {
  let tmpDir: string

  beforeEach(() => {
    clearConfigCache()
    tmpDir = join(tmpdir(), `openwaggle-test-${Date.now()}`)
    mkdirSync(join(tmpDir, '.openwaggle'), { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('parses project preferences and nested Pi settings from settings JSON', async () => {
    writeFileSync(
      getSettingsPath(tmpDir),
      JSON.stringify({
        preferences: {
          model: 'openai-codex/gpt-5.4',
          thinkingLevel: 'xhigh',
        },
        pi: {
          compaction: { enabled: false },
        },
      }),
      'utf-8',
    )

    const config = await loadProjectConfig(tmpDir)
    expect(config.preferences).toEqual({
      model: 'openai-codex/gpt-5.4',
      thinkingLevel: 'xhigh',
    })
    expect(config.pi).toEqual({ compaction: { enabled: false } })
  })

  it('returns empty config when file is missing', async () => {
    const config = await loadProjectConfig(join(tmpDir, 'nonexistent'))
    expect(config).toEqual({})
  })

  it('returns empty config when config metadata read fails unexpectedly', async () => {
    const invalidProjectPath = join(tmpDir, 'bad\0path')
    const config = await loadProjectConfig(invalidProjectPath)
    expect(config).toEqual({})
  })

  it('returns empty config for invalid JSON with warning', async () => {
    writeFileSync(getSettingsPath(tmpDir), '{{invalid json}}', 'utf-8')
    const config = await loadProjectConfig(tmpDir)
    expect(config).toEqual({})
  })

  it('returns empty config when known project sections are absent', async () => {
    writeFileSync(getSettingsPath(tmpDir), JSON.stringify({ other: { key: 'value' } }), 'utf-8')
    const config = await loadProjectConfig(tmpDir)
    expect(config).toEqual({})
  })

  it('creates .openwaggle/settings.json when ensuring project settings', async () => {
    const isolatedDir = join(tmpDir, 'new-project')
    mkdirSync(isolatedDir, { recursive: true })

    await ensureProjectSettingsFile(isolatedDir)

    const configPath = getSettingsPath(isolatedDir)
    expect(existsSync(configPath)).toBe(true)
    expect(readFileSync(configPath, 'utf-8')).toBe('{}\n')
    const config = await loadProjectConfig(isolatedDir)
    expect(config).toEqual({})
  })

  it('merges project preferences into existing settings JSON', async () => {
    writeFileSync(
      getSettingsPath(tmpDir),
      JSON.stringify({
        pi: {
          compaction: { enabled: true },
        },
      }),
      'utf-8',
    )

    await setProjectPreferences(tmpDir, { model: 'openai/gpt-4.1', thinkingLevel: 'high' })

    const config = await loadProjectConfig(tmpDir)
    expect(config.preferences).toEqual({ model: 'openai/gpt-4.1', thinkingLevel: 'high' })
    expect(config.pi).toEqual({ compaction: { enabled: true } })
  })

  it('preserves nested Pi settings when persisting preferences', async () => {
    writeFileSync(
      getSettingsPath(tmpDir),
      JSON.stringify({
        pi: {
          compaction: { enabled: false },
        },
      }),
      'utf-8',
    )

    await setProjectPreferences(tmpDir, { model: 'openai/gpt-4.1' })

    const config = await loadProjectConfig(tmpDir)
    expect(config.pi).toEqual({ compaction: { enabled: false } })
    expect(config.preferences).toEqual({ model: 'openai/gpt-4.1' })
  })

  it('fails safely on invalid settings parsing during update and does not overwrite file', async () => {
    const configPath = getSettingsPath(tmpDir)
    writeFileSync(configPath, '{{invalid json}}', 'utf-8')
    const before = readFileSync(configPath, 'utf-8')

    await expect(
      updateProjectConfig(tmpDir, (current) => ({
        ...current,
        preferences: {
          ...current.preferences,
          thinkingLevel: 'high',
        },
      })),
    ).rejects.toThrow()

    const after = readFileSync(configPath, 'utf-8')
    expect(after).toBe(before)
  })

  it('returns the settings path from getProjectSettingsPath', () => {
    expect(getProjectSettingsPath(tmpDir)).toBe(getSettingsPath(tmpDir))
  })
})
