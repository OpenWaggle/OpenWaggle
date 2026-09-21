import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ensureProjectSettingsFile,
  getProjectSettingsPath,
  listProjectAuthorizationGrants,
  loadProjectConfig,
  loadProjectConfigStrict,
  setProjectPreferences,
  updateProjectConfig,
} from '../project-config'

function getSettingsPath(projectPath: string) {
  return join(projectPath, '.openwaggle', 'settings.json')
}

describe('loadProjectConfig', () => {
  let tmpDir: string

  beforeEach(() => {
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

  it('parses project Session Host overrides from settings JSON', async () => {
    writeFileSync(
      getSettingsPath(tmpDir),
      JSON.stringify({
        sessionHost: {
          multiAgentEnabled: false,
          parentConcurrencyLimit: 12,
        },
      }),
      'utf-8',
    )

    const config = await loadProjectConfig(tmpDir)
    expect(config.sessionHost).toEqual({
      multiAgentEnabled: false,
      parentConcurrencyLimit: 12,
    })
  })

  it('rejects invalid project Session Host limits without applying a partial policy', async () => {
    writeFileSync(
      getSettingsPath(tmpDir),
      JSON.stringify({
        sessionHost: {
          multiAgentEnabled: true,
          parentConcurrencyLimit: 0,
        },
      }),
      'utf-8',
    )

    await expect(updateProjectConfig(tmpDir, (current) => current)).rejects.toThrow(
      /positive safe integer/i,
    )
    expect(await loadProjectConfig(tmpDir)).toEqual({})
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

  it('fails closed for permission-sensitive reads of an invalid project file', async () => {
    writeFileSync(
      getSettingsPath(tmpDir),
      JSON.stringify({
        sessionHost: { multiAgentEnabled: false },
        preferences: { authorizationMode: 'not-a-mode' },
      }),
      'utf-8',
    )

    expect(await loadProjectConfig(tmpDir)).toEqual({})
    await expect(loadProjectConfigStrict(tmpDir)).rejects.toThrow(
      /invalid project settings schema/i,
    )
    await expect(listProjectAuthorizationGrants(tmpDir)).rejects.toThrow(
      /invalid project settings schema/i,
    )
  })

  it('treats a missing file as inheritance but rejects an unreadable settings path', async () => {
    await expect(loadProjectConfigStrict(join(tmpDir, 'missing'))).resolves.toEqual({})
    mkdirSync(getSettingsPath(tmpDir))
    await expect(loadProjectConfigStrict(tmpDir)).rejects.toThrow()
  })

  it('rejects an empty settings file for permission-sensitive reads', async () => {
    writeFileSync(getSettingsPath(tmpDir), '', 'utf-8')
    await expect(loadProjectConfigStrict(tmpDir)).rejects.toThrow(/empty project settings file/i)
  })

  it('rejects a broken settings symlink instead of treating it as an absent file', async () => {
    symlinkSync(join(tmpDir, 'missing-settings.json'), getSettingsPath(tmpDir))
    await expect(loadProjectConfigStrict(tmpDir)).rejects.toThrow()
  })

  it('rejects a broken project config directory symlink', async () => {
    rmSync(join(tmpDir, '.openwaggle'), { recursive: true })
    symlinkSync(join(tmpDir, 'missing-config'), join(tmpDir, '.openwaggle'))
    await expect(loadProjectConfigStrict(tmpDir)).rejects.toThrow()
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
