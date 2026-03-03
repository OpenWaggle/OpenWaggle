import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clearConfigCache,
  ensureProjectConfigFile,
  loadProjectConfig,
  setWriteFileTrust,
  updateProjectConfig,
} from './project-config'

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

  it('parses valid TOML with all quality tiers', async () => {
    writeFileSync(
      join(tmpDir, '.openwaggle', 'config.toml'),
      `
[quality.low]
temperature = 0.2
max_tokens = 1000

[quality.medium]
temperature = 0.5
max_tokens = 3000

[quality.high]
temperature = 0.7
max_tokens = 6000
top_p = 0.8
`,
    )

    const config = await loadProjectConfig(tmpDir)
    expect(config.quality?.low).toEqual({ temperature: 0.2, maxTokens: 1000 })
    expect(config.quality?.medium).toEqual({ temperature: 0.5, maxTokens: 3000 })
    expect(config.quality?.high).toEqual({ temperature: 0.7, maxTokens: 6000, topP: 0.8 })
  })

  it('returns empty config when file is missing', async () => {
    const config = await loadProjectConfig(join(tmpDir, 'nonexistent'))
    expect(config).toEqual({})
  })

  it('returns empty config for invalid TOML with warning', async () => {
    writeFileSync(join(tmpDir, '.openwaggle', 'config.toml'), '{{invalid toml}}')
    const config = await loadProjectConfig(tmpDir)
    expect(config).toEqual({})
  })

  it('handles partial overrides — only some tiers present', async () => {
    writeFileSync(
      join(tmpDir, '.openwaggle', 'config.toml'),
      `
[quality.high]
max_tokens = 8000
`,
    )

    const config = await loadProjectConfig(tmpDir)
    expect(config.quality?.low).toBeUndefined()
    expect(config.quality?.medium).toBeUndefined()
    expect(config.quality?.high).toEqual({ maxTokens: 8000 })
  })

  it('ignores non-numeric values in tier overrides', async () => {
    writeFileSync(
      join(tmpDir, '.openwaggle', 'config.toml'),
      `
[quality.medium]
temperature = "not a number"
max_tokens = 3000
`,
    )

    const config = await loadProjectConfig(tmpDir)
    expect(config.quality?.medium).toEqual({ maxTokens: 3000 })
  })

  it('returns empty config when quality section is absent', async () => {
    writeFileSync(join(tmpDir, '.openwaggle', 'config.toml'), '[other]\nkey = "value"\n')
    const config = await loadProjectConfig(tmpDir)
    expect(config).toEqual({})
  })

  it('ignores out-of-range values', async () => {
    writeFileSync(
      join(tmpDir, '.openwaggle', 'config.toml'),
      `
[quality.medium]
temperature = -5
top_p = 1.5
max_tokens = 0
`,
    )

    const config = await loadProjectConfig(tmpDir)
    // All values out of range — tier has no valid overrides
    expect(config.quality?.medium).toBeUndefined()
  })

  it('keeps valid values and ignores invalid ones in the same tier', async () => {
    writeFileSync(
      join(tmpDir, '.openwaggle', 'config.toml'),
      `
[quality.high]
temperature = 0.8
top_p = -1
max_tokens = 5000
`,
    )

    const config = await loadProjectConfig(tmpDir)
    expect(config.quality?.high).toEqual({ temperature: 0.8, maxTokens: 5000 })
  })

  it('creates .openwaggle/config.toml on first trust write when missing', async () => {
    const isolatedDir = join(tmpDir, 'new-project')
    mkdirSync(isolatedDir, { recursive: true })

    await setWriteFileTrust(isolatedDir, true, 'test')

    const configPath = join(isolatedDir, '.openwaggle', 'config.toml')
    expect(existsSync(configPath)).toBe(true)
    const config = await loadProjectConfig(isolatedDir)
    expect(config.approvals?.tools?.writeFile?.trusted).toBe(true)
  })

  it('persists writeFile trust metadata', async () => {
    await setWriteFileTrust(tmpDir, true, 'tool-approval')

    const config = await loadProjectConfig(tmpDir)
    expect(config.approvals?.tools?.writeFile?.trusted).toBe(true)
    expect(config.approvals?.tools?.writeFile?.source).toBe('tool-approval')
    expect(config.approvals?.tools?.writeFile?.timestamp).toBeDefined()
  })

  it('fails safely on invalid config parsing during update and does not overwrite file', async () => {
    const configPath = join(tmpDir, '.openwaggle', 'config.toml')
    writeFileSync(configPath, '{{invalid toml}}', 'utf-8')
    const before = readFileSync(configPath, 'utf-8')

    await expect(
      updateProjectConfig(tmpDir, (current) => ({
        ...current,
        approvals: {
          tools: {
            writeFile: {
              trusted: true,
            },
          },
        },
      })),
    ).rejects.toThrow()

    const after = readFileSync(configPath, 'utf-8')
    expect(after).toBe(before)
  })

  it('ensureProjectConfigFile creates file when missing', async () => {
    const isolatedDir = join(tmpDir, 'ensure-project')
    mkdirSync(isolatedDir, { recursive: true })

    const filePath = await ensureProjectConfigFile(isolatedDir)
    expect(existsSync(filePath)).toBe(true)
  })
})
